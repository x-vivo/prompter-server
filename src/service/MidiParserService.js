export default class MidiParserService {
	constructor({onMessage}){
		this.onMessage = onMessage;
	}
	parse(buff){
		new String(buff)
		.split('\n')
		.filter(message => message)
		.map(message => this.parseMessage(message.split(' ').map(part => parseInt(part, 16))));
	}
	parseMessage(message){
		const byte = message.shift();
		switch (byte){
			case 242:// Song Position Pointer
				console.log('SPP', message);
				this.onMessage({type:'SPP'});
				break;
			case 248:
				this.onMessage({type:'TIMING_CLOCK'});
				break;
			case 250:
				this.onMessage({type:'START'});
				break;
			case 251:
				this.onMessage({type:'CONTINUE'});
				break;
			case 252:
				this.onMessage({type:'STOP'});
				break;
			case 254:
				this.onMessage({type:'ACTIVE_SENSING'});
				break;
			case 255:
				this.onMessage({type:'RESET'});
				break;
			default:
			break;
		}
	}
}