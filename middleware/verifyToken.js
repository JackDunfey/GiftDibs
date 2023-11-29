// first rewritten in a long time
const jwt = require('jsonwebtoken');
require("dotenv/config");
function verifyToken(req, res, next){
    if(req.cookies.token){
        jwt.verify(req.cookies.token, process.env.JWT_SECRET, (err, decoded) => {
            if(err){
                res.status(400).json({ error: "Invalid token" });
            } else {
                req.decoded = decoded.uid ? decoded : null;
                next();
            }
        });
    } else {
        req.decoded = null;
        next();
    }
}
module.exports = verifyToken;