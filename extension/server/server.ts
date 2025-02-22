import express from 'express';
import auth from './auth';
import cors from 'cors';
import path from 'path';

import { init, id } from "@instantdb/admin";
import dotenv from 'dotenv';

console.log(`
   =================================
   STARTING SERVER.TS
   ================================= 
`);

dotenv.config({
    path: [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../', '.env')],
});

const APP_ID = "8c28dd52-4859-4560-8d45-2408b064b248";
const db = init({ appId: APP_ID, adminToken:  process.env.INSTANTDB_ADMIN_TOKEN || '' });

const app = express();
const PORT = 3001;

app.use(cors());

// serve client directory
app.use(express.static(path.join(__dirname, '../client')));

app.get('/payload', auth, (req, res) => {
    res.json({
        kasdjkf: 'aksdfsdf'
    })
})

app.post('/payload', auth, async (req, res) => {
    console.log('working')
    let text = '';
    if(req.payload.user_id === '118373299') {
        text = 'ANOTHER ONE';
    } else {
        text = 'WHO ARE YOU?'
    }

    const result = await db.transact(
        db.tx.messages[id()].update({
            text,
            done: false,
            createdAt: Date.now(),
        })
    );

    console.log('result: ', result);

    return res.json({
        status: 'OK'
    });
});


app.listen(PORT, () => {
    console.log('listening on port: ', PORT);
})