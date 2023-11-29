function redirectAnonymous(req, res, next){
    if(!req.decoded){
        res.redirect('/login');
    } else{
        next();
    }
}
module.exports = redirectAnonymous;