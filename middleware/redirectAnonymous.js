function redirectAnonymous(req, res, next){
    if(req.decoded)
        return next();
    if(req.method === "GET"){
        res.redirect('/login'+(
            req.originalUrl==="/" ? "" : `?redirect=${encodeURIComponent(req.originalUrl)}`
        ));
    }
}
module.exports = redirectAnonymous;