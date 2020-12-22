/*
 * This file is part of the BigConnect project.
 *
 * Copyright (c) 2013-2020 MWARE SOLUTIONS SRL
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License version 3
 * as published by the Free Software Foundation with the addition of the
 * following permission added to Section 15 as permitted in Section 7(a):
 * FOR ANY PART OF THE COVERED WORK IN WHICH THE COPYRIGHT IS OWNED BY
 * MWARE SOLUTIONS SRL, MWARE SOLUTIONS SRL DISCLAIMS THE WARRANTY OF
 * NON INFRINGEMENT OF THIRD PARTY RIGHTS
 *
 * This program is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
 * or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU Affero General Public License for more details.
 * You should have received a copy of the GNU Affero General Public License
 * along with this program; if not, see http://www.gnu.org/licenses or write to
 * the Free Software Foundation, Inc., 51 Franklin Street, Fifth Floor,
 * Boston, MA, 02110-1301 USA, or download the license from the following URL:
 * https://www.gnu.org/licenses/agpl-3.0.txt
 *
 * The interactive user interfaces in modified source and object code versions
 * of this program must display Appropriate Legal Notices, as required under
 * Section 5 of the GNU Affero General Public License.
 *
 * You can be released from the requirements of the license by purchasing
 * a commercial license. Buying such a license is mandatory as soon as you
 * develop commercial activities involving the BigConnect software without
 * disclosing the source code of your own applications.
 *
 * These activities include: offering paid services to customers as an ASP,
 * embedding the product in a web application, shipping BigConnect with a
 * closed source product.
 */

/*global self:true*/
/*global onmessage:true*/
/*global console:true*/
/*global publicData:true*/
/*global store:false*/
/*global BASE_URL:true*/
/*global importScripts:false*/

/*eslint strict:0*/
this.importScripts('../../../libs/@babel/polyfill/dist/polyfill.min.js');
this.importScripts('../../../jsc/ontologyConstants.js');

var BASE_URL = '../../..',
    self = this,
    needsInitialSetup = true,
    publicData = {},
    ajaxFilters = { pre: [], post: [] },
    pluginsLoaded = (function() {
        var _resolve, _isFinished = false;
        return {
            promise: new Promise(r => {_resolve = r}),
            isFinished() { return _isFinished; },
            resolve() { _isFinished = true; _resolve() }
        }
    })();

var timer, todo = [], setupInProgress = true;
onmessage = function(event) {
    if (needsInitialSetup) {
        todo = [];
        needsInitialSetup = false;
        setupInProgress = true;
        setupAll(JSON.parse(event.data));
        return;
    }

    if (setupInProgress) {
        todo.push(event);
        return;
    }

    require([
        'underscore',
        'util/promise'
    ], function(_, Promise) {
        onMessageHandler(event);
    })
};

function setupComplete() {
    setupInProgress = false;
    todo.forEach(event => onmessage(event));
}

function setupAll(data) {
    self.bcEnvironment = data.environment;
    setupConsole();
    setupWebsocket(data);
    var resolveStore;
    publicData.storePromise = new Promise(f => {resolveStore = f});
    setupRequireJs(data, () => {
        pluginsLoaded.resolve();
        documentExtensionPoints();
        setupRedux(data).then(resolveStore);
        setupComplete();
    });
}

function setupRedux(data) {
    return new Promise(resolve => {
        require(['data/web-worker/store'], function(_store) {
            try {
                const store = _store.getStore();
                const state = store.getState();
                dispatchMain('reduxStoreInit', { state });
                resolve(store);
            } catch(e) {
                console.error(e)
                throw e;
            }
        });
    })
}

function setupConsole() {
    var noop = function() {};

    if (typeof console === 'undefined') {
        console = {
            log: log('log'),
            info: log('info'),
            debug: log('debug'),
            error: log('error'),
            warn: log('warn'),
            group: noop,
            groupCollapsed: noop,
            groupEnd: noop
        };
    }
    function log(type) {
        return function() {
            dispatchMain('brokenWorkerConsole', {
                logType: type,
                messages: Array.prototype.slice.call(arguments, 0).map(function(arg) {
                    return JSON.stringify(arg);
                })
            });
        }
    }
}

function setupWebsocket(data) {
    var isFirefox = navigator && navigator.userAgent && ~navigator.userAgent.indexOf('Firefox'),
        supportedInWorker = !!(this.WebSocket || this.MozWebSocket) && !isFirefox;

    if (supportedInWorker) {
        self.window = self;
        importScripts(BASE_URL + '/libs/atmosphere.js/lib/atmosphere.js?' + data.cacheBreaker);
        atmosphere.util.getAbsoluteURL = function() {
            return publicData.atmosphereConfiguration.url;
        }
        self.closeSocket = function() {
            if (publicData.socket) {
                publicData.socket.close();
            }
        }
        self.pushSocketMessage = function(message) {
            Promise.all([
                Promise.require('util/websocket'),
                new Promise(function(fulfill, reject) {
                    if (atmosphere.util.__socketOpened) {
                        fulfill(publicData.socket);
                    }
                    atmosphere.util.__socketPromiseFulfill = fulfill;
                    atmosphere.util.__socketPromiseReject = reject;
                })
            ]).done(function(results) {
                var websocketUtils = results[0],
                    socket = results[1];

                websocketUtils.pushDataToSocket(socket, publicData.socketSourceGuid, message);
            });
        }
    } else {
        dispatchMain('websocketNotSupportedInWorker');
        self.closeSocket = function() {
            dispatchMain('websocketLegacyClose');
        }
        self.pushSocketMessage = function(message) {
            dispatchMain('websocketFromWorker', { message: message });
        }
    }
}

function setupRequireJs(data, callback) {
    if (typeof File === 'undefined') {
        self.File = Blob;
    }
    if (typeof FormData === 'undefined') {
        importScripts('./util/formDataPolyfill.js?' + data.cacheBreaker);
    }
    importScripts(BASE_URL + '/jsc/require.config.js?' + data.cacheBreaker);
    require.baseUrl = BASE_URL + '/jsc/';
    require.urlArgs = data.cacheBreaker;
    importScripts(BASE_URL + '/libs/requirejs/require.js?' + data.cacheBreaker);

    if(bcEnvironment.prod) {
        require.load = asyncRequireJSLoader
    }

    Promise.all(
        data.webWorkerResources.map(src => {
            return new Promise(function(done, error) {
                require([src], done, error)
            })
        })
    ).then(callback).catch(error => {
        console.error(error);
        throw error;
    })
}

function onMessageHandler(event) {
    var data = event.data;
    processMainMessage(data);
}

function processMainMessage(data) {
    if (data.type) {
        require(['data/web-worker/handlers/' + data.type], function(handler) {
            handler(data);
        });
    } else console.warn('Unhandled message to worker', event);
}

function documentExtensionPoints() {
    require(['configuration/plugins/registry'], function(registry) {
        /**
         * Extension to register new listeners for websocket messages. Must be registered in JavaScript file registered with `app.registerWebWorkerJavaScript` in web app plugin.
         *
         * @param {string} name The message name to listen for. Matches the
         * `type` parameter in message json
         * @param {function} handler The function to invoke when messages
         * arrive. Accepts one parameter: `data`
         */
        registry.documentExtensionPoint('org.bigconnect.websocket.message',
            'Add custom websocket message handlers',
            function(e) {
                return ('name' in e) && _.isFunction(e.handler)
            },
            'https://docs.bigconnect.io/developer-guide/plugin-development/web-plugins/extension-point-reference-1/websocket'
        );
    })
}

var lastPost = 0,
    MAX_SEND_RATE_MILLIS = 500,
    postMessageQueue = [],
    drainTimeout;
function dispatchMain(type, message) {
    var now = Date.now(),
        duration = now - lastPost;

    if (drainTimeout) {
        clearTimeout(drainTimeout);
    }

    if (!type) {
        throw new Error('dispatchMain requires type argument');
    }
    message = message || {};
    message.type = type;

    postMessageQueue.push(message);

    if (type === 'rebroadcastEvent' && duration < MAX_SEND_RATE_MILLIS) {
        drainTimeout = setTimeout(drainMessageQueue, MAX_SEND_RATE_MILLIS - duration);
        return;
    }

    drainMessageQueue();
}

function drainMessageQueue() {
    try {
        postMessage(postMessageQueue);
        postMessageQueue.length = 0;
        lastPost = Date.now();
    } catch(e) {
        var jsonString = JSON.stringify(postMessageQueue);
        postMessage({
            type: 'brokenWorkerConsole',
            logType: 'error',
            messages: ['error posting', e.message, jsonString]
        });
    }
}

 function ajaxPostfilter(xmlHttpRequest, json, options) {
    ajaxFilters.post.forEach(f => f.apply(null, arguments))
}
function ajaxPrefilter(xmlHttpRequest, method, url, parameters) {
    if (publicData) {
        var filters = [
                setWorkspaceHeader,
                setCsrfHeader,
                setSourceGuidHeader,
                setGraphTracing
                // TODO: set timezone
            ], invoke = function(f) {
                f();
            };

        filters.forEach(invoke);
    }

    function setWorkspaceHeader() {
        var hasWorkspaceParam = typeof (parameters && parameters.workspaceId) !== 'undefined';
        if (publicData.currentWorkspaceId && !hasWorkspaceParam) {
            xmlHttpRequest.setRequestHeader('BC-Workspace-Id', publicData.currentWorkspaceId);
        }
    }
    function setCsrfHeader() {
        var eligibleForProtection = !(/get/i).test(method),
            user = publicData.currentUser,
            token = user && user.csrfToken;

        if (eligibleForProtection && token) {
            xmlHttpRequest.setRequestHeader('BC-CSRF-Token', token);
        }
    }
    function setSourceGuidHeader() {
        var isUpdate = !(/get/i).test(method),
            guid = publicData.socketSourceGuid;

        if (isUpdate && guid) {
            xmlHttpRequest.setRequestHeader('BC-Source-Guid', guid);
        }
    }
    function setGraphTracing() {
        if (publicData.graphTraceEnable) {
            xmlHttpRequest.setRequestHeader('graphTraceEnable', 'true');
        }
    }
   ajaxFilters.pre.forEach(f => f.apply(null, arguments))
}

function asyncRequireJSLoader(context, moduleName, url) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'blob';
    xhr.onload = function(e) {
        if (this.status === 200) {
            var blob = new Blob([this.response], { type: 'text/javascript' });
            var blobURL = URL.createObjectURL(blob);
            importScripts(blobURL);
            URL.revokeObjectURL(blobURL);
            context.completeLoad(moduleName);
        } else {
            context.onError(new Error('Require for ' + moduleName + ' failed at ' + url));
        }
    };
    xhr.onerror = function() {
        context.onError(new Error('Require for ' + moduleName + ' failed at ' + url));
    }
    xhr.send();
}
