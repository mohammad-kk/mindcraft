import fs from 'fs';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import settings from '../../../settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class CivilizationManager {
    constructor(configPath) {
        this.configPath = configPath;
        this.config = null;
        this.agents = [];
        this.agentProcesses = {};
        this.initialized = false;
        this.centralLocation = null;
    }

    async initialize() {
        try {
            const configData = fs.readFileSync(this.configPath, 'utf8');
            this.config = JSON.parse(configData);
            this.centralLocation = this.config.central_location;
            this.initialized = true;
            console.log(`Initialized civilization: ${this.config.name}`);
            return true;
        } catch (error) {
            console.error('Failed to initialize civilization:', error);
            return false;
        }
    }

    async spawnAgents() {
        if (!this.initialized) {
            console.error('Civilization not initialized');
            return false;
        }

        // Create temporary profiles for each agent
        const tempProfilesDir = path.join(__dirname, '../../../temp_profiles');
        if (!fs.existsSync(tempProfilesDir)) {
            fs.mkdirSync(tempProfilesDir, { recursive: true });
        }

        // Spawn agents for each role
        for (const role of this.config.roles) {
            for (let i = 0; i < role.count; i++) {
                const agentName = `${role.name}_${i}`;
                const profilePath = await this.createAgentProfile(role, agentName, tempProfilesDir);
                
                if (profilePath) {
                    await this.spawnAgent(agentName, profilePath, role);
                }
            }
        }

        console.log(`Spawned ${this.agents.length} agents for civilization: ${this.config.name}`);
        return true;
    }

    async createAgentProfile(role, agentName, tempProfilesDir) {
        try {
            // Read the base profile
            const baseProfileData = fs.readFileSync(role.base_profile, 'utf8');
            const baseProfile = JSON.parse(baseProfileData);
            
            // Create a new profile with role-specific settings
            const newProfile = {
                ...baseProfile,
                name: agentName,
                role: role.name,
                civilization: this.config.name,
                modes: role.modes || {}
            };
            
            // Save the new profile
            const profilePath = path.join(tempProfilesDir, `${agentName}.json`);
            fs.writeFileSync(profilePath, JSON.stringify(newProfile, null, 2));
            
            return profilePath;
        } catch (error) {
            console.error(`Failed to create profile for ${agentName}:`, error);
            return null;
        }
    }

    async spawnAgent(agentName, profilePath, role) {
        return new Promise((resolve) => {
            // Prepare task arguments if applicable
            let taskArgs = [];
            if (role.tasks && role.tasks.length > 0) {
                // Use the first task in the list for now
                taskArgs = [
                    '--task_path', 'benchmark_tasks.json',
                    '--task_id', role.tasks[0]
                ];
            }

            // Spawn the agent process
            const agentProcess = spawn('node', [
                'src/process/init_agent.js',
                agentName,
                '--profile', profilePath,
                ...taskArgs,
                '--count_id', this.agents.length
            ], {
                stdio: 'inherit'
            });

            this.agents.push(agentName);
            this.agentProcesses[agentName] = agentProcess;

            agentProcess.on('close', (code) => {
                console.log(`Agent ${agentName} process exited with code ${code}`);
                delete this.agentProcesses[agentName];
                this.agents = this.agents.filter(a => a !== agentName);
            });

            // Give some time between agent spawns to avoid overwhelming the server
            setTimeout(() => resolve(), 2000);
        });
    }

    async stopAllAgents() {
        for (const agentName of this.agents) {
            if (this.agentProcesses[agentName]) {
                this.agentProcesses[agentName].kill();
            }
        }
        
        this.agents = [];
        this.agentProcesses = {};
        console.log(`Stopped all agents for civilization: ${this.config.name}`);
    }

    getAgentsByRole(roleName) {
        if (!this.initialized) return [];
        
        const role = this.config.roles.find(r => r.name === roleName);
        if (!role) return [];
        
        return this.agents.filter(agentName => agentName.startsWith(roleName));
    }

    async broadcastMessage(message, targetRole = null) {
        if (!this.initialized) return;
        
        const targetAgents = targetRole 
            ? this.getAgentsByRole(targetRole)
            : this.agents;
            
        for (const agentName of targetAgents) {
            // Use the mind server to send messages to agents
            // This requires integration with your existing mind_server.js
            try {
                const mindServer = (await import('../../server/mind_server.js')).getIO();
                mindServer.emit('send-message', agentName, message);
            } catch (error) {
                console.error(`Failed to send message to ${agentName}:`, error);
            }
        }
    }

    getCivilizationStatus() {
        if (!this.initialized) return null;
        
        return {
            name: this.config.name,
            population: this.agents.length,
            populationLimit: this.config.population_limit,
            roles: this.config.roles.map(role => ({
                name: role.name,
                count: this.getAgentsByRole(role.name).length,
                targetCount: role.count
            })),
            centralLocation: this.centralLocation
        };
    }
}

export default CivilizationManager;