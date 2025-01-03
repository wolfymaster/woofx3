import express from 'express';
import auth from './auth';
import cors from 'cors';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(auth);


app.get('/payload', (req, res) => {
    res.json({
        kasdjkf: 'aksdfsdf'
    })
})

app.post('/payload', (req, res) => {
    return res.json({
        status: 'OK'
    });
});


app.listen(PORT, () => {
    console.log('listening on port: ', PORT);
})