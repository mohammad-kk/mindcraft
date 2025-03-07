#!/usr/bin/env python3
import argparse
import json
import os
import subprocess
import time
import shutil
from datetime import datetime
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns

def load_config(config_path):
    """Load the benchmark configuration."""
    with open(config_path, 'r') as f:
        return json.load(f)

def setup_profile(model_profile):
    """Copy the model profile to the active profile location."""
    profile_path = model_profile["profile"]
    # Ensure the profile exists
    if not os.path.exists(profile_path):
        raise FileNotFoundError(f"Profile not found: {profile_path}")
    
    # Get the profile name from the file
    with open(profile_path, 'r') as f:
        profile_data = json.load(f)
        agent_name = profile_data["name"]
    
    # Create a temporary profile for this benchmark run
    benchmark_profile_path = f"./{agent_name}.json"
    shutil.copy(profile_path, benchmark_profile_path)
    
    return agent_name, benchmark_profile_path

def edit_settings(profiles):
    """Edit settings.js to use the specified profiles."""
    # Create a temporary settings file with the profiles
    settings_content = f"""
    export default {{
        profiles: {json.dumps(profiles)},
        allow_insecure_coding: true,
        port: 55916,
        num_examples: 3,
        relevant_docs_count: 5,
        code_timeout_mins: 5,
        base_profile: "./profiles/defaults/_default.json"
    }}
    """
    
    with open("settings.js.tmp", 'w') as f:
        f.write(settings_content)
    
    # Backup original settings
    if os.path.exists("settings.js"):
        shutil.copy("settings.js", "settings.js.bak")
    
    # Replace settings
    shutil.move("settings.js.tmp", "settings.js")

def restore_settings():
    """Restore original settings.js."""
    if os.path.exists("settings.js.bak"):
        shutil.move("settings.js.bak", "settings.js")

def run_benchmark(model, task, config, run_number):
    """Run a single benchmark for a model on a task."""
    print(f"Running benchmark: {model['name']} on {task['id']} (Run {run_number})")
    
    # Setup the model profile
    agent_name, profile_path = setup_profile(model)
    
    # Edit settings to use this profile
    edit_settings([profile_path])
    
    # Prepare results directory
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    results_dir = f"benchmark_results/{timestamp}/{model['name']}/{task['id']}/run_{run_number}"
    os.makedirs(results_dir, exist_ok=True)
    
    # Run the task
    start_time = time.time()
    
    # Launch Minecraft server if not already running
    # This assumes your server is set up and can be started with the evaluation script
    
    # Run the task using main.js with appropriate arguments
    cmd = [
        "node", 
        "main.js", 
        "--task_path", "benchmark_tasks.json", 
        "--task_id", task['id']
    ]
    
    try:
        process = subprocess.run(
            cmd, 
            check=True,
            capture_output=True,
            text=True,
            timeout=task.get('time_limit', 900) + 60  # Add 60 seconds buffer
        )
        
        # Save stdout and stderr
        with open(f"{results_dir}/stdout.log", 'w') as f:
            f.write(process.stdout)
        
        with open(f"{results_dir}/stderr.log", 'w') as f:
            f.write(process.stderr)
            
    except subprocess.TimeoutExpired:
        print(f"Task timed out: {model['name']} on {task['id']}")
        with open(f"{results_dir}/timeout.log", 'w') as f:
            f.write("Task timed out")
    except Exception as e:
        print(f"Error running task: {e}")
        with open(f"{results_dir}/error.log", 'w') as f:
            f.write(f"Error: {str(e)}")
    
    end_time = time.time()
    time_taken = end_time - start_time
    
    # Copy memory.json and other relevant files
    memory_path = f"bots/{agent_name}/memory.json"
    if os.path.exists(memory_path):
        shutil.copy(memory_path, f"{results_dir}/memory.json")
    
    # Copy action code files
    action_code_dir = f"bots/{agent_name}/action-code/"
    if os.path.exists(action_code_dir):
        os.makedirs(f"{results_dir}/action-code", exist_ok=True)
        for file in os.listdir(action_code_dir):
            shutil.copy(f"{action_code_dir}/{file}", f"{results_dir}/action-code/{file}")
    
    # Check task completion
    success = check_task_completion(agent_name, task['id'])
    
    # Calculate metrics
    metrics = calculate_metrics(agent_name, time_taken, success)
    
    # Save metrics
    with open(f"{results_dir}/metrics.json", 'w') as f:
        json.dump(metrics, f, indent=2)
    
    return metrics

def check_task_completion(agent_name, task_id):
    """Check if the task was completed successfully."""
    memory_path = f"bots/{agent_name}/memory.json"
    try:
        with open(memory_path, 'r') as f:
            memory = json.load(f)
            
        # Check the last system message in turns
        for turn in reversed(memory['turns']):
            if turn['role'] == 'system' and 'code' in turn['content']:
                # Extract completion code
                if 'code : 2' in turn['content']:
                    return True  # Task successful
                elif 'code : 4' in turn['content']:
                    return False  # Task failed
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"Error reading memory for agent {agent_name}: {e}")
    
    return False  # Default to failure if no conclusive result found

def calculate_metrics(agent_name, time_taken, success):
    """Calculate metrics for the benchmark run."""
    memory_path = f"bots/{agent_name}/memory.json"
    metrics = {
        "task_completion": success,
        "time_taken": time_taken,
        "code_generation_attempts": 0,
        "code_execution_success_rate": 0,
        "tokens_consumed": 0
    }
    
    try:
        with open(memory_path, 'r') as f:
            memory = json.load(f)
        
        # Count code generation attempts
        code_attempts = 0
        code_successes = 0
        
        for turn in memory['turns']:
            if turn['role'] == 'system' and 'Generated code:' in turn['content']:
                code_attempts += 1
            if turn['role'] == 'system' and 'Code generation result: true' in turn['content']:
                code_successes += 1
        
        metrics["code_generation_attempts"] = code_attempts
        
        if code_attempts > 0:
            metrics["code_execution_success_rate"] = code_successes / code_attempts
        
        # Estimate tokens consumed (this is approximate)
        total_chars = sum(len(turn['content']) for turn in memory['turns'])
        metrics["tokens_consumed"] = total_chars / 4  # Rough estimate: 4 chars per token
        
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"Error calculating metrics for agent {agent_name}: {e}")
    
    return metrics

def generate_report(results, config, output_dir):
    """Generate a comprehensive benchmark report."""
    # Create DataFrame from results
    data = []
    
    for model_name, model_results in results.items():
        for task_id, task_runs in model_results.items():
            for run_num, metrics in task_runs.items():
                data.append({
                    "Model": model_name,
                    "Task": task_id,
                    "Run": run_num,
                    "Completed": metrics["task_completion"],
                    "Time (s)": metrics["time_taken"],
                    "Code Attempts": metrics["code_generation_attempts"],
                    "Code Success Rate": metrics["code_execution_success_rate"],
                    "Tokens": metrics["tokens_consumed"]
                })
    
    df = pd.DataFrame(data)
    
    # Save raw data
    df.to_csv(f"{output_dir}/benchmark_data.csv", index=False)
    
    # Generate summary statistics
    summary = df.groupby(["Model", "Task"]).agg({
        "Completed": "mean",
        "Time (s)": "mean",
        "Code Attempts": "mean",
        "Code Success Rate": "mean",
        "Tokens": "mean"
    }).reset_index()
    
    summary.to_csv(f"{output_dir}/benchmark_summary.csv", index=False)
    
    # Generate plots
    plt.figure(figsize=(12, 8))
    
    # Completion rate by model and task
    plt.subplot(2, 2, 1)
    completion_pivot = df.pivot_table(
        values="Completed", 
        index="Task", 
        columns="Model", 
        aggfunc="mean"
    )
    sns.heatmap(completion_pivot, annot=True, cmap="YlGnBu", vmin=0, vmax=1)
    plt.title("Task Completion Rate")
    
    # Time taken by model and task
    plt.subplot(2, 2, 2)
    sns.barplot(x="Model", y="Time (s)", hue="Task", data=df)
    plt.title("Average Time to Completion")
    plt.xticks(rotation=45)
    
    # Code success rate by model
    plt.subplot(2, 2, 3)
    sns.barplot(x="Model", y="Code Success Rate",