import * as dotenv from 'dotenv'
dotenv.config()
import { io, Socket } from 'socket.io-client';
import { getGithubDataFromDb } from '../integrations/github.js';

export class GravitySocketManager {
  private socket: Socket;

  constructor() {
    this.socket = io(`${process.env.GRAVITY_SOCKET_URL}?type=wave`, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 10000,
      auth: {
        gravityApiKey: process.env.GRAVITY_API_KEY
      }
    })

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
      } catch (error: any) {
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

