import net from 'net';

const encrypt = (payload) => {
    let key = 171;
    const buffer = Buffer.from(payload);
    const encrypted = Buffer.alloc(buffer.length);

    for (let i = 0; i < buffer.length; i++) {
        key = key ^ buffer[i];
        encrypted[i] = key;
    }

    const sizeBuf = Buffer.alloc(4);
    sizeBuf.writeInt32BE(buffer.length);

    return Buffer.concat([sizeBuf, encrypted]);
};

const decrypt = (payload) => {
    let key = 171;
    const decrypted = Buffer.alloc(payload.length);

    for (let i = 0; i < payload.length; i++) {
        const nextKey = payload[i];
        decrypted[i] = key ^ nextKey;
        key = nextKey;
    }

    return decrypted.toString();
};

const sendCommand = (ip, payload) => {
    return new Promise((resolve, reject) => {
        const client = new net.Socket();
        client.connect(9999, ip, () => {
            client.write(encrypt(JSON.stringify(payload)));
        });

        let buffer = Buffer.alloc(0);
        client.on('data', (data) => {
            buffer = Buffer.concat([buffer, data]);
            if (buffer.length >= 4) {
                const size = buffer.readInt32BE(0);
                if (buffer.length >= size + 4) {
                    const response = decrypt(buffer.slice(4, size + 4));
                    resolve(JSON.parse(response));
                    client.destroy();
                }
            }
        });

        client.on('error', (err) => {
            reject(err);
            client.destroy();
        });
    });
};

export const kasaLightsOn = () => {
    sendCommand('192.168.1.43', {"system":{"set_relay_state":{"state":1}}});
    sendCommand('192.168.1.202', {"system":{"set_relay_state":{"state":1}}});
};
export const kasaLightsOff = () => {
    sendCommand('192.168.1.43', {"system":{"set_relay_state":{"state":0}}});
    sendCommand('192.168.1.202', {"system":{"set_relay_state":{"state":0}}});
};

// turnOn().then(console.log).catch(console.error);
// or
// try {
//     const response = await turnOn();
//     console.log(response);
// } catch(err) {
//     console.error(err);
// }