'use strict';

const http = require('http');
const EventEmitter = require('events');
const EE_ERROR = 'Registering more than one listener to a WebSocket is not supported.';
function noop() {}
function abortConnection(socket, code, name) {
    socket.end('HTTP/1.1 ' + code + ' ' + name + '\r\n\r\n');
}
const native = (() => {
    try {
        return require(`./uws_${process.platform}_${process.versions.modules}`);
    } catch (e) {
        const version = process.version.substring(1).split('.').map(function(n) {
            return parseInt(n);
        });
        const lessThanSixFour = version[0] < 6 || (version[0] === 6 && version[1] < 4);
        if (process.platform === 'win32' && lessThanSixFour) {
            throw new Error('µWebSockets requires Node.js 6.4.0 or greater on Windows.');
        } else {
            throw new Error('Compilation of µWebSockets has failed and there is no pre-compiled binary ' +
            'available for your system. Please install a supported C++11 compiler and reinstall the module \'uws\'.');
        }
    }
})();

var _upgradeReq = null;
const clientGroup = native.client.group.create();
native.client.group.onConnection(clientGroup, (external) => {
    const webSocket = native.getUserData(external);
    webSocket.external = external;
    webSocket.internalOnOpen();
});

native.client.group.onMessage(clientGroup, (message, webSocket) => {
    webSocket.internalOnMessage(message);
});

native.client.group.onDisconnection(clientGroup, (external, code, message, webSocket) => {
    webSocket.external = null;
    webSocket.internalOnClose(code, message);
    native.clearUserData(external);
});

native.client.group.onPing(clientGroup, (message, webSocket) => {
    webSocket.onping(message);
});

native.client.group.onPong(clientGroup, (message, webSocket) => {
    webSocket.onpong(message);
});

native.client.group.onError(clientGroup, (webSocket) => {
    process.nextTick(() => {
        webSocket.internalOnError();
    });
});

class WebSocket {
    constructor(external) {
        this.external = external;
        this.internalOnMessage = noop;
        this.internalOnClose = noop;
        this.onping = noop;
        this.onpong = noop;
    }

    get upgradeReq() {
        return _upgradeReq;
    }

    set onmessage(f) {
        if (f) {
            this.internalOnMessage = (message) => {
                f({data: message});
            };
        } else {
            this.internalOnMessage = noop;
        }
    }

    set onclose(f) {
        if (f) {
            this.internalOnClose = (code, message) => {
                f({code: code, reason: message});
            };
        } else {
            this.internalOnClose = noop;
        }
    }

    emit(eventName, arg1, arg2) {
        if (eventName === 'message') {
            this.internalOnMessage(arg1);
        } else if (eventName === 'close') {
            this.internalOnClose(arg1, arg2);
        } else if (eventName === 'ping') {
            this.onping(arg1);
        } else if (eventName === 'pong') {
            this.onpong(arg1);
        }
        return this;
    }

    on(eventName, f) {
        if (eventName === 'message') {
            if (this.internalOnMessage !== noop) {
                throw Error(EE_ERROR);
            }
            this.internalOnMessage = f;
        } else if (eventName === 'close') {
            if (this.internalOnClose !== noop) {
                throw Error(EE_ERROR);
            }
            this.internalOnClose = f;
        } else if (eventName === 'ping') {
            if (this.onping !== noop) {
                throw Error(EE_ERROR);
            }
            this.onping = f;
        } else if (eventName === 'pong') {
            if (this.onpong !== noop) {
                throw Error(EE_ERROR);
            }
            this.onpong = f;
        } else if (eventName === 'open') {
            if (this.internalOnOpen !== noop) {
                throw Error(EE_ERROR);
            }
            this.internalOnOpen = f;
        } else if (eventName === 'error') {
            if (this.internalOnError !== noop) {
                throw Error(EE_ERROR);
            }
            this.internalOnError = f;
        }
        return this;
    }

    once(eventName, f) {
        if (eventName === 'message') {
            if (this.internalOnMessage !== noop) {
                throw Error(EE_ERROR);
            }
            this.internalOnMessage = (message) => {
                f(message);
                this.internalOnMessage = noop;
            };
        } else if (eventName === 'close') {
            if (this.internalOnClose !== noop) {
                throw Error(EE_ERROR);
            }
            this.internalOnClose = (code, message) => {
                f(code, message);
                this.internalOnClose = noop;
            };
        } else if (eventName === 'ping') {
            if (this.onping !== noop) {
                throw Error(EE_ERROR);
            }
            this.onping = () => {
                f();
                this.onping = noop;
            };
        } else if (eventName === 'pong') {
            if (this.onpong !== noop) {
                throw Error(EE_ERROR);
            }
            this.onpong = () => {
                f();
                this.onpong = noop;
            };
        }
        return this;
    }

    removeAllListeners(eventName) {
        if (!eventName || eventName === 'message') {
            this.internalOnMessage = noop;
        }
        if (!eventName || eventName === 'close') {
            this.internalOnClose = noop;
        }
        if (!eventName || eventName === 'ping') {
            this.onping = noop;
        }
        if (!eventName || eventName === 'pong') {
            this.onpong = noop;
        }
        return this;
    }

    removeListener(eventName, cb) {
        if (eventName === 'message' && this.internalOnMessage === cb) {
            this.internalOnMessage = noop;
        } else if (eventName === 'close' && this.internalOnClose === cb) {
            this.internalOnClose = noop;
        } else if (eventName === 'ping' && this.onping === cb) {
            this.onping = noop;
        } else if (eventName === 'pong' && this.onpong === cb) {
            this.onpong = noop;
        }
        return this;
    }

    get OPEN() {
        return WebSocketClient.OPEN;
    }

    get CLOSED() {
        return WebSocketClient.CLOSED;
    }

    get readyState() {
        return this.external ? WebSocketClient.OPEN : WebSocketClient.CLOSED;
    }

    get _socket() {
        const address = this.external ? native.getAddress(this.external) : new Array(3);
        return {
            remotePort: address[0],
            remoteAddress: address[1],
            remoteFamily: address[2]
        };
    }

    ping(message, options, dontFailWhenClosed) {
        send(message, WebSocketClient.OPCODE_PING);
    }

    // from here down, functions are not common between client and server

    terminate() {
        if (this.external) {
            native.server.terminate(this.external);
            this.external = null;
        }
    }

    send(message, options, cb) {
        if (this.external) {
            if (typeof options === 'function') {
                cb = options;
                options = null;
            }

            const binary = options && options.binary || typeof message !== 'string';
            native.server.send(this.external, message, binary ? WebSocketClient.OPCODE_BINARY : WebSocketClient.OPCODE_TEXT, cb ? (() => {
                process.nextTick(cb);
            }) : undefined);
        } else if (cb) {
            cb(new Error('not opened'));
        }
    }

    close(code, data) {
        if (this.external) {
            const external = this.external;
            process.nextTick(() => {
                native.server.close(external, code, data);
            });
            this.external = null;
        }
    }
}

class WebSocketClient extends WebSocket {
    constructor(uri) {
        super(null);
        this.internalOnOpen = noop;
        this.internalOnError = noop;
        native.connect(clientGroup, uri, this);
    }

    terminate() {
        if (this.external) {
            native.client.terminate(this.external);
            this.external = null;
        }
    }

    send(message, options, cb) {
        if (this.external) {
            if (typeof options === 'function') {
                cb = options;
                options = null;
            }

            const binary = options && options.binary || typeof message !== 'string';
            native.client.send(this.external, message, binary ? WebSocketClient.OPCODE_BINARY : WebSocketClient.OPCODE_TEXT, cb ? (() => {
                process.nextTick(cb);
            }) : undefined);
        } else if (cb) {
            cb(new Error('not opened'));
        }
    }

    close(code, data) {
        if (this.external) {
            const external = this.external;
            process.nextTick(() => {
                native.client.close(external, code, data);
            });
            this.external = null;
        }
    }
}

class Server extends EventEmitter {
    constructor(options, callback) {
        super();

        var nativeOptions = WebSocketClient.PERMESSAGE_DEFLATE;
        if (options.perMessageDeflate !== undefined) {
            if (options.perMessageDeflate === false) {
                nativeOptions = 0;
            } else {
                if (options.perMessageDeflate.serverNoContextTakeover === true) {
                    nativeOptions |= WebSocketClient.SERVER_NO_CONTEXT_TAKEOVER;
                }
                if (options.perMessageDeflate.clientNoContextTakeover === true) {
                    nativeOptions |= WebSocketClient.CLIENT_NO_CONTEXT_TAKEOVER;
                }
            }
        }

        this.serverGroup = native.server.group.create(nativeOptions, options.maxPayload === undefined ? 1048576 : options.maxPayload);

        // can these be made private?
        this._upgradeCallback = noop;
        this._upgradeListener = null;
        this._noDelay = options.noDelay === undefined ? true : options.noDelay;
        this._lastUpgradeListener = true;

        if (!options.noServer) {
            this.httpServer = options.server ? options.server : http.createServer((request, response) => {
                // todo: default HTTP response
                response.end();
            });

            if (options.path && (!options.path.length || options.path[0] !== '/')) {
                options.path = '/' + options.path;
            }

            this.httpServer.on('upgrade', this._upgradeListener = ((request, socket, head) => {
                if (!options.path || options.path == request.url.split('?')[0].split('#')[0]) {
                    if (options.verifyClient) {
                        const info = {
                            origin: request.headers.origin,
                            secure: request.connection.authorized !== undefined || request.connection.encrypted !== undefined,
                            req: request
                        };

                        if (options.verifyClient.length === 2) {
                            options.verifyClient(info, (result, code, name) => {
                                if (result) {
                                    this.handleUpgrade(request, socket, head, (ws) => {
                                        this.emit('connection', ws);
                                    });
                                } else {
                                    abortConnection(socket, code, name);
                                }
                            });
                        } else {
                            if (options.verifyClient(info)) {
                                this.handleUpgrade(request, socket, head, (ws) => {
                                    this.emit('connection', ws);
                                });
                            } else {
                                abortConnection(socket, 400, 'Client verification failed');
                            }
                        }
                    } else {
                        this.handleUpgrade(request, socket, head, (ws) => {
                            this.emit('connection', ws);
                        });
                    }
                } else {
                    if (this._lastUpgradeListener) {
                        abortConnection(socket, 400, 'URL not supported');
                    }
                }
            }));

            this.httpServer.on('newListener', (eventName, listener) => {
                if (eventName === 'upgrade') {
                    this._lastUpgradeListener = false;
                }
            });
        }

        native.server.group.onDisconnection(this.serverGroup, (external, code, message, webSocket) => {
            webSocket.external = null;
            webSocket.internalOnClose(code, message);
            native.clearUserData(external);
        });

        native.server.group.onMessage(this.serverGroup, (message, webSocket) => {
            webSocket.internalOnMessage(message);
        });

        native.server.group.onPing(this.serverGroup, (message, webSocket) => {
            webSocket.onping(message);
        });

        native.server.group.onPong(this.serverGroup, (message, webSocket) => {
            webSocket.onpong(message);
        });

        native.server.group.onConnection(this.serverGroup, (external) => {
            const webSocket = new WebSocket(external);
            native.setUserData(external, webSocket);
            this._upgradeCallback(webSocket);
            _upgradeReq = null;
        });

        if (options.port) {
            if (options.host) {
                this.httpServer.listen(options.port, options.host, callback);
            } else {
                this.httpServer.listen(options.port, callback);
            }
        }
    }

    handleUpgrade(request, socket, upgradeHead, callback) {
        const secKey = request.headers['sec-websocket-key'];
        const socketHandle = socket.ssl ? socket._parent._handle : socket._handle;
        const sslState = socket.ssl ? socket.ssl._external : null;
        if (secKey && secKey.length == 24) {
            socket.setNoDelay(this._noDelay);
            const ticket = native.transfer(socketHandle.fd === -1 ? socketHandle : socketHandle.fd, sslState);
            socket.on('close', (error) => {
                _upgradeReq = request;
                this._upgradeCallback = callback ? callback : noop;
                native.upgrade(this.serverGroup, ticket, secKey, request.headers['sec-websocket-extensions']);
            });
        }
        socket.destroy();
    }

    /*prepareMessage(message, binary) {
        return this.nativeServer.prepareMessage(message, binary ? WebSocketClient.OPCODE_BINARY : WebSocketClient.OPCODE_TEXT);
    }

    finalizeMessage(preparedMessage) {
        return this.nativeServer.finalizeMessage(preparedMessage);
    }*/

    broadcast(message, options) {
        native.server.group.broadcast(this.serverGroup, message, options && options.binary || false);
    }

    close() {
        if (this._upgradeListener && this.httpServer) {
            this.httpServer.removeListener('upgrade', this._upgradeListener);
            this.httpServer.close();
        }

        if (this.serverGroup) {
            native.server.group.close(this.serverGroup);
            native.server.group.delete(this.serverGroup);
            this.serverGroup = null;
        }
    }
}

WebSocketClient.PERMESSAGE_DEFLATE = 1;
WebSocketClient.SERVER_NO_CONTEXT_TAKEOVER = 2;
WebSocketClient.CLIENT_NO_CONTEXT_TAKEOVER = 4;
WebSocketClient.OPCODE_TEXT = 1;
WebSocketClient.OPCODE_BINARY = 2;
WebSocketClient.OPCODE_PING = 9;
WebSocketClient.OPEN = 1;
WebSocketClient.CLOSED = 0;
WebSocketClient.Server = Server;
WebSocketClient.native = native;
module.exports = WebSocketClient;
