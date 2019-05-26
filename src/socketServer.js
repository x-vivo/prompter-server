const ws = require('ws');
const schedule = require('node-schedule');
const uuid = require('node-uuid');
const { spawnSync, spawn } = require('child_process');
import MidiParserService from './service/MidiParserService';

const PORT = 5050;

class PrompterServer {
	constructor(){
		this.clients = {};
		this.callTimeout = 20000;
		this.callPingInterval = 10;
		this.midiParserService = new MidiParserService({
			onMessage: message => this.processMidi(message)
		});
		this.midiListenerProcess;
		this.timingClockOffset = 0;
		this.songStatus = 'STOP';
		this.songTimeSignature = '4/4';
		this.ticksPerClap = 24;
		
		this.webSocketServer = new ws.Server({
			port: PORT
		});
	
		this.webSocketServer.on('connection', ws => {
			this.processConnection({
				socket: ws
			});
		});
	
		this.jobs = {
			'PING': schedule.scheduleJob(`*/${this.callPingInterval} * * * * *`, () => {
				console.log('PING job');
			})
		};
	}

	processConnection(options) {
		var id = uuid.v1();
		this.clients[id] = options.socket;
		options.socket.on('message', message => {
			message = JSON.parse(message);

			console.log(message.type);

			switch (message.type) {
				case 'ID':
					this.processCommandId({
						socketId: id,
						message
					});
					break;
				case 'LIST_CONNECTIONS_REQUEST':
					this.processCommandListConnections({
						socketId: id,
						message
					});
					break;
				case 'CONNECT':
					this.processCommandConnect({
						socketId: id,
						message
					});
					break;
				case 'DISCONNECT':
					this.processCommandDisconnect({
						socketId: id,
						message
					});
					break;
				default:
					console.log('Unexpected message: ', message);
					break;
			}
		});
		options.socket.on('close', () => {
			console.log('####################################### socket closed:', id);
			delete this.clients[id];
		});

		this.clients[id].send(JSON.stringify({
			type: 'REQUEST_ID'
		}));

		if(this.midiListenerProcess && this.midiListenerProcess.connected && this.midiListenerProcess.spawnargs && this.midiListenerProcess.spawnargs[1]){
			this.clients[id].send(JSON.stringify({
				type: 'MIDI_CONNECTED',
				payload: {
					connectionId: this.midiListenerProcess.spawnargs[1].replace('-p', '')
				}
			}));
		}

		Object.values(this.clients).map(client => client.send(JSON.stringify({
			type: 'CLIENT_LIST',
			payload: Object.keys(this.clients)
		})));
	}

	processCommandId(options) {
		console.log(options);
	};
	processMidi(message){
		let broadcastMessage = message;
		if(message.type === 'TIMING_CLOCK'){
			this.timingClockOffset ++;

			if(this.timingClockOffset % 6 === 1 && this.songStatus === 'PLAYING'){
				Object.values(this.clients).map(client => client.send(`F${(Math.floor(this.timingClockOffset / 6) + 1) % 16 + 1}`));
			}

			if(this.timingClockOffset % this.ticksPerClap === 1){
				if(!message.payload){
					message.payload = {};
				}
				const clap = Math.floor(this.timingClockOffset / this.ticksPerClap) + 1;
				message.payload.clap = (clap % 4) + 1;
				message.payload.bar = Math.floor(clap / 4);
			}
			if(!message.payload){
				broadcastMessage = undefined;
			}
		}
		if(message.type === 'START'){
			this.songStatus = 'PLAYING';
			this.timingClockOffset = 0;
		}
		if(message.type === 'STOP'){
			this.songStatus = 'STOP';
			this.timingClockOffset = 0;
		}

		if(!broadcastMessage || this.songStatus === 'STOP'){
			return;
		}
		Object.values(this.clients).map(client => client.send(JSON.stringify({
			type: 'MIDI',
			payload: message
		})));
	}
	processCommandConnect({socketId, message}){
		this.midiListenerProcess = spawn('amidi', [`-p${message.payload}`, '-d']);
		this.midiListenerProcess.stdout.on('data', chunk => {
			this.midiParserService.parse(chunk);
		});
		this.midiListenerProcess.on('close', (code) => {
			console.log(`child process exited with code ${code}`);
			Object.values(this.clients).map(client => client.send(JSON.stringify({
				type: 'MIDI_DISCONNECTED',
				payload: {
					connectionId: message.payload
				}
			})));
		});
		console.log('connected', this.midiListenerProcess);
		Object.values(this.clients).map(client => client.send(JSON.stringify({
			type: 'MIDI_CONNECTED',
			payload: {
				connectionId: message.payload
			}
		})));
	}
	processCommandDisconnect({socketId, message}){
		if(!this.midiListenerProcess){
			return this.clients[socketId].send(JSON.stringify({
				type: 'ERROR',
				payload: 'No active connections found'
			}));
		}
		if(this.midiListenerProcess.spawnargs[1].replace('-p', '') != message.payload){
			return this.clients[socketId].send(JSON.stringify({
				type: 'ERROR',
				payload: 'Incorrect active connection id'
			}));
		}
		this.midiListenerProcess.kill();
	}
	processCommandListConnections({socketId, message}) {
		const child = spawnSync('amidi', ['-l']);
		const [header, ...connectionsData] = new String(child.stdout).split('\n');
		const connections = connectionsData.reduce((connections, connectionData) => {
				const [connectionDir, port, ...data] = connectionData.trim().replace(/ +(?= )/g,'').split(' ');
				connections[port] = data.join(' ');
				return connections;
			}, {});
		delete connections['undefined'];
		this.clients[socketId].send(JSON.stringify({
			type: 'LIST_CONNECTIONS_RESPONSE',
			payload: connections
		}));
	};
};

new PrompterServer();
