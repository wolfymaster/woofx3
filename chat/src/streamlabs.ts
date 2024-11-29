import SockJS from 'sockjs-client';

interface RPCRequestBody {
    jsonrpc: string;
    id: number;
    method: string;
    params: {
        resource: string,
        args: any,
    }
}

const PORT = 59650; 

const baseUrl = `http://172.29.160.1:${PORT}/api`;

const token = '5e4e042c9834db74e4223861b1728424cb4de';

let id = 1;

const requests = [];
const subscriptions = [];

function makeSockJSClient() {

    const ws = new SockJS(baseUrl);

    ws.onopen = () => {
        console.log('open');
        request('TcpServerService', 'auth', token).then(() => {
            console.log('authed');
        })

        // request('ScenesService', 'getScenes').then( scenes => {
        //     console.log('scenes', scenes);
        //     scenes.forEach(scene => {
        //         console.log('scene: ', scene.id, scene.name);
        //     });
        // });        

        // request('SourcesService', 'getSources').then (sources => {
        //     sources.forEach( source => {
        //         console.log('source:', source.id, source.name);
        //     })
        // })

        getActiveScene().then(scene => {
            console.log('scene', scene);
            const items = scene.nodes;

            const browser = items.find(item => item.name === '_browser');

            const resourceId = scene.resourceId;
            const itemId = browser.sceneItemId; 

            console.log(resourceId, itemId);

            request(resourceId, 'getItem', itemId).then(browserItem => {
                request(browserItem.resourceId, 'setVisibility', 'true')
            })


        });

        // switchScene('scene_bc24a839-126e-4bf8-a295-c7657f4b9219');
        // getSourcesForCurrentScene();
    }

    ws.onmessage = (msg) => {
        console.log('message: ', msg);
        onMessageHandler(msg.data);
    }

    ws.onerror = (err) => {
        console.error('ERRRRR', err);
    }

    ws.onclose = () => {
        console.log('close');
    }

    return ws;
}

function switchScene(sceneId: string) {
    request('ScenesService', 'makeSceneActive', sceneId);
}

function getActiveScene() {
    return request('ScenesService', 'activeScene').then(scene => {
        console.log(scene);
        return scene;
    })
}

function getSourcesForCurrentScene() {
    request('ScenesService', 'getSourcesForCurrentScene').then(sources => {
        console.log(sources);
    });
}

function makeRequestHandler(ws: any) {
    return (resourceId: string, method: string, ...args: any) => {
        let requestBody: RPCRequestBody = {
            jsonrpc: '2.0',
            id: id++,
            method,
            params: { resource: resourceId, args }
        }
    
        const body = JSON.stringify(requestBody)
        console.log('sending: ', body);

        return new Promise((resolve, reject) => {
            requests[requestBody.id] = {
              body: requestBody,
              resolve,
              reject,
              completed: false
            };
            ws.send(JSON.stringify(requestBody));
        });
    }
}

function onMessageHandler(data: any) {
    let message = JSON.parse(data);
    let request = requests[message.id];

    console.log('resolving: ', message.id)
    request.resolve(message.result);

    // const result = message.result;
    // subscriptions[message.result.resourceId](result.data);
}

const ws = makeSockJSClient();
const request = makeRequestHandler(ws);


process.on('SIGINT', () => {
    console.log('\nTerminating connection...');
    ws.close();
    process.exit(0);
  });
