import { io, Socket } from 'socket.io-client';
import { getGithubDataFromDb } from '../integrations/github';

export class GravitySocketManager {
  private socket: Socket;

  constructor(gravityUrl: string) {
    this.socket = io(gravityUrl);
    this.setupSocketListeners();
  }

  private setupSocketListeners() {
    this.socket.on('connect', () => {
      console.log('Connected to Gravity socket');
    });

    this.socket.on('query', async (data) => {
      try {
        const { queryName, type } = data;
        let result;

        switch (type) {
          case 'github':
            result = await getGithubDataFromDb(data.installationId);
            break;
          default:
            console.warn(`Unknown type: ${type}`);
            return;
        }

        this.socket.emit('queryResult', {
          queryName,
          result,
        });
      } catch (error) {
        console.error(`Error executing query ${data.queryName}:`, error);
        this.socket.emit('queryError', {
          queryName: data.queryName,
          error: error.message,
        });
      }
    });

    this.socket.on('disconnect', () => {
      console.log('Disconnected from Gravity socket');
    });
  }
}

