import { contextBridge, ipcRenderer } from 'electron'
import log from 'electron-log'
import { allowedChannels, allowedEvents } from './ipcChannelWhitelist'
import { preview, previewArgs } from './logPreview'

const CHANNEL_WIDTH = 30;

contextBridge.exposeInMainWorld(
    "api", {
        invoke: async (channel, ...data) => {
            const paddedChannel = channel.padEnd(CHANNEL_WIDTH);
            log.debug(
                `%cMAIN <<< RENDERER: %c${paddedChannel}%cArgs: ${previewArgs(data)}`,
                'color: cyan', 'color: green', 'color: unset'
            );
            if (allowedChannels.includes(channel)) {
                const promise = ipcRenderer.invoke(channel, ...data);
                promise.then((returnVal) => {
                    log.debug(
                        `%cMAIN >>> RENDERER: %c${paddedChannel}%cResponse: ${returnVal ? preview(returnVal) : 'No Response'}`,
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
