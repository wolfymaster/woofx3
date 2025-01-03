import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';

dotenv.config();

export default function auth(req, res, next) {
    const token = req.headers?.authorization;


    if(!token) {
        next(new Error('Unauthorized'));
    }

    try {
        const secret = new Buffer(process.env.EXTENSION_JWT_SECRET?.trim(), 'base64');
        req.payload = jwt.verify(token.trim(), secret);
        next();
    } catch(err) {
        console.log(err);
        next(err);
    }
}