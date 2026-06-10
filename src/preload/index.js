import { contextBridge, ipcRenderer } from 'electron'
import log from 'electron-log'
import { allowedChannels, allowedEvents } from './ipcChannelWhitelist'

const CHANNEL_WIDTH = 30;

contextBridge.exposeInMainWorld(
    "api", {
        invoke: async (channel, ...data) => {
            const paddedChannel = channel.padEnd(CHANNEL_WIDTH);
            log.debug(
                `%cMAIN <<< RENDERER: %c${paddedChannel}%cArgs: ${data.map((arg, i) => `[${i}]: ${JSON.stringify(arg)}`).join(' ')}`,
                'color: cyan', 'color: green', 'color: unset'
            );
            if (allowedChannels.includes(channel)) {
                const promise = ipcRenderer.invoke(channel, ...data);
                promise.then((returnVal) => {
                    log.debug(
                        `%cMAIN >>> RENDERER: %c${paddedChannel}%cResponse: ${(returnVal ? JSON.stringify(returnVal) : 'No Response').slice(0, 100)}`,
                        'color: magenta', 'color: green', 'color: unset'
                    );
                });
                return promise;
            }
        },
        on: (channel, listener) => {
            if (!allowedEvents.includes(channel)) return () => {}
            const wrapped = (_event, ...args) => listener(...args)
            ipcRenderer.on(channel, wrapped)
            return () => ipcRenderer.removeListener(channel, wrapped)
        },
    }
);
