#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import CivilizationManager from './agent/civilization/civilization_manager.js';
import { createMindServer } from './server/mind_server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Initialize readline interface
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Start the mind server
const server = createMindServer(8080);
console.log('Mind server started on port 8080');

let civilizationManager = null;

function displayHelp() {
    console.log('\nCivilization Manager Commands:');
    console.log('  load <config_path>     - Load a civilization configuration');
    console.log('  spawn                  - Spawn all agents defined in the configuration');
    console.log('  status                 - Display the current status of the civilization');
    console.log('  stop                   - Stop all agents in the civilization');
    console.log('  broadcast <message>    - Send a message to all agents');
    console.log('  message <role> <msg>   - Send a message to agents with a specific role');
    console.log('  help                   - Display this help message');
    console.log('  exit                   - Exit the program\n');
}

async function processCommand(input) {
    const args = input.trim().split(' ');
    const command = args[0].toLowerCase();

    switch (command) {
        case 'load':
            if (args.length < 2) {
                console.log('Please specify a configuration file path');
                break;
            }
            const configPath = args[1];
            civilizationManager = new CivilizationManager(configPath);
            const success = await civilizationManager.initialize();
            if (success) {
                console.log(`Loaded civilization configuration from ${configPath}`);
            }
            break;

        case 'spawn':
            if (!civilizationManager || !civilizationManager.initialized) {
                console.log('Please load a civilization configuration first');
                break;
            }
            await civilizationManager.spawnAgents();
            break;

        case 'status':
            if (!civilizationManager || !civilizationManager.initialized) {
                console.log('No civilization loaded');
                break;
            }
            const status = civilizationManager.getCivilizationStatus();
            console.log('\nCivilization Status:');
            console.log(`  Name: ${status.name}`);
            console.log(`  Population: ${status.population}/${status.populationLimit}`);
            console.log('  Roles:');
            status.roles.forEach(role => {
                console.log(`    - ${role.name}: ${role.count}/${role.targetCount}`);
            });
            console.log(`  Central Location: (${status.centralLocation.x}, ${status.centralLocation.y}, ${status.centralLocation.z})\n`);
            break;

        case 'stop':
            if (!civilizationManager || !civilizationManager.initialized) {
                console.log('No civilization loaded');
                break;
            }
            await civilizationManager.stopAllAgents();
            break;

        case 'broadcast':
            if (!civilizationManager || !civilizationManager.initialized) {
                console.log('No civilization loaded');
                break;
            }
            const message = args.slice(1).join(' ');
            await civilizationManager.broadcastMessage(message);
            console.log(`Broadcast message to all agents: "${message}"`);
            break;

        case 'message':
            if (!civilizationManager || !civilizationManager.initialized) {
                console.log('No civilization loaded');
                break;
            }
            if (args.length < 3) {
                console.log('Please specify a role and a message');
                break;
            }
            const role = args[1];
            const roleMessage = args.slice(2).join(' ');
            await civilizationManager.broadcastMessage(roleMessage, role);
            console.log(`Sent message to ${role} agents: "${roleMessage}"`);
            break;

        case 'help':
            displayHelp();
            break;

        case 'exit':
            if (civilizationManager) {
                await civilizationManager.stopAllAgents();
            }
            rl.close();
            process.exit(0);
            break;

        default:
            console.log(`Unknown command: ${command}`);
            displayHelp();
            break;
    }
}

// Main loop
console.log('Civilization Manager CLI');
displayHelp();

rl.setPrompt('civilization> ');
rl.prompt();

rl.on('line', async (input) => {
    await processCommand(input);
    rl.prompt();
}).on('close', () => {
    console.log('Exiting Civilization Manager');
    process.exit(0);
});

// Handle process termination
process.on('SIGINT', async () => {
    console.log('\nReceived SIGINT. Shutting down...');
    if (civilizationManager) {
        await civilizationManager.stopAllAgents();
    }
    process.exit(0);
});