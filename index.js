const path = require("path");
const {v5: uuidv5} = require("uuid");
require("dotenv/config");

const DEBUG = false;
const DB_PERFORMANCE_MODE = false
const DB_LOG = true;

const express = require("express");
const app = express();
const PORT = 80;
const HOST = "localhost";
const verifyToken = require("./middleware/verifyToken");
const redirectAnonymous = require("./middleware/redirectAnonymous");

app.use("/static", express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json()); // middleware (express.text) can also be used <- this is bad practice (kind of)
app.use(require("cookie-parser")());
app.set("view engine", "pug");
app.set("views", path.join(__dirname, "views"));

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const db = require("better-sqlite3");

const database = DB_LOG ? new db(path.join(__dirname, "databases/database.sqlite"), { verbose: console.log }) : new db(path.join(__dirname, "databases/database.sqlite"));
if(DB_PERFORMANCE_MODE){
    database.pragma("journal_mode = WAL");
}
// DB SETUP
database.function("get_inviteID", (group_id) => uuidv5(group_id.toString(), process.env.UUID_NAMESPACE));
database.prepare("CREATE TABLE IF NOT EXISTS users (uid INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, email TEXT, password TEXT)").run();
database.prepare("CREATE TABLE IF NOT EXISTS groups (uid INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, description TEXT)").run();
database.prepare("CREATE TABLE IF NOT EXISTS gifts (uid INTEGER PRIMARY KEY AUTOINCREMENT, from_ INTEGER, to_ INTEGER, group_id INTEGER, title TEXT, description TEXT, link TEXT)").run();
database.prepare("CREATE TABLE IF NOT EXISTS membership (uid INTEGER PRIMARY KEY AUTOINCREMENT, user INTEGER, group_id INTEGER)").run();
database.prepare("CREATE TABLE IF NOT EXISTS messages (uid INTEGER PRIMARY KEY AUTOINCREMENT, from_ INTEGER, group_id INTEGER, message TEXT)").run();
database.prepare("CREATE TABLE IF NOT EXISTS invites (uid INTEGER PRIMARY KEY AUTOINCREMENT, from_ INTEGER, to_ INTEGER, group_id INTEGER)").run();
// STATEMENTS
// TODO: research joins
const createGroupStatement = database.prepare("INSERT INTO groups (name, description) VALUES (?, ?)");
const giveGroupInviteId = database.prepare("UPDATE groups SET invite_id = get_inviteID(?) WHERE uid = ?");
const getGroupByInviteId = database.prepare("SELECT * FROM groups WHERE invite_id = ?");

const createMessageStatement = database.prepare("INSERT INTO messages (from_, group_id, message) VALUES (?, ?, ?)");
const getMessagesByGroupStatement = database.prepare("SELECT messages.message, from_.uid as 'from_', from_.username as 'from_name' FROM messages JOIN users from_ ON messages.from_ == from_.uid WHERE messages.group_id = ?");

const createUserStatement = database.prepare("INSERT INTO users (username, email, password) VALUES (?, ?, ?)");
const findUserByEmailStatement = database.prepare("SELECT * FROM users WHERE email = ?");
const getUserById = database.prepare("SELECT * FROM users WHERE uid = ?");
const findGroupStatement = database.prepare("SELECT * FROM groups WHERE uid = ?");
const getGroupMembersStatement = database.prepare("SELECT * FROM users WHERE uid IN (SELECT user FROM membership WHERE group_id = ?)");

const createGiftStatement = database.prepare("INSERT INTO gifts (from_, to_, group_id, title, description, link) VALUES (?, ?, ?, ?, ?, ?)");
const getOutgoingGifts = database.prepare("SELECT * FROM users JOIN gifts ON gifts.to_ = users.uid WHERE from_ = ?");
const getGiftsAndUsersByGroupStatement = database.prepare("SELECT gifts.uid, gifts.from_, gifts.to_, gifts.group_id, gifts.title, gifts.description, gifts.link, to_.username as 'to', from_.username as 'from' FROM gifts JOIN users to_ ON gifts.to_ = to_.uid JOIN users from_ ON gifts.from_ = from_.uid WHERE gifts.group_id = ? AND gifts.to_ != ?");
const getGiftById = database.prepare("SELECT * FROM gifts WHERE uid = ?");
const deleteGiftById = database.prepare("DELETE FROM gifts WHERE uid = ?");
const updateGiftStatement = database.prepare("UPDATE gifts SET title = ?, description = ?, link = ? WHERE uid = ?");

const addMemberStatement = database.prepare("INSERT INTO membership (user, group_id) VALUES (?, ?)");
const getUsersGroupsStatement = database.prepare("SELECT * FROM groups WHERE uid IN (SELECT group_id FROM membership WHERE user = ?)");
const checkMembershipStatement = database.prepare("SELECT * FROM membership WHERE user = ? AND group_id = ?");
const deleteMembershipStatement = database.prepare("DELETE FROM membership WHERE user = ? AND group_id = ?");

const inviteUserStatement = database.prepare("INSERT INTO invites (from_, to_, group_id) VALUES (?, ?, ?)");
const deleteInviteStatement = database.prepare("DELETE FROM invites WHERE to_ = ? AND group_id = ?");
const isInvitedStatement = database.prepare("SELECT * FROM invites WHERE to_ = ? AND group_id = ?");
const getInviteStatement = database.prepare("SELECT * FROM invites WHERE from_ = ? AND to_ = ? AND group_id = ?");
const getUserGroupInviteStatement = database.prepare("SELECT invites.uid, invites.from_, invites.to_, invites.group_id, groups.name, groups.description FROM invites JOIN groups ON invites.group_id = groups.uid WHERE invites.to_ = ?");
const getPendngInvitesByGroup = database.prepare("SELECT invites.uid, invites.group_id, from_.username as 'from_name', to_.username as 'to_name', from_.uid as 'from_', to_.uid as 'to_' FROM invites JOIN users to_ ON invites.to_ = to_.uid JOIN users from_ ON invites.from_ = from_.uid WHERE invites.group_id = ?");
// TODO: Add messages last


// REGISTER AND LOGIN
function registerUser(username, email, password) {
    const user = database.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if(user){
        return [false, "Username already taken"];
    }
    const hashedPassword = bcrypt.hashSync(password, 10);
    createUserStatement.run(username, email, hashedPassword);
    if (DEBUG) console.log(`Registered user ${username} with email ${email} and password ${password}`);
    // FIXME: BELOW LINE IS INSECURE BUT COULD BE EASILY FIXED
    const userid = database.prepare("SELECT uid FROM users WHERE username = ? AND email = ?").pluck().get(username, email);
    return [true, userid]; // return true if successful, false if not
}
app.get("/register", (req, res) => {
    res.render("register");
});
app.post("/register", async (req, res) => {
    const { username, email, password } = req.body;
    let [success, data] = registerUser(username, email, password)
    if(success){
        return res.cookie("token", jwt.sign({ uid: data }, process.env.JWT_SECRET)).redirect("/");
    } else {
        return res.status(400).json({ success: false, error: data });
    }
});
app.get("/login", (req, res) => {
    res.render("login");
});
app.post("/login", async (req, res) => {
    const { email, password } = req.body;
    const user = database.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (!user)
        return res.status(400).json({ error: "User not found" });
    if (bcrypt.compareSync(password, user.password)) {
        const token = jwt.sign({ uid: user.uid }, process.env.JWT_SECRET);
        return res.cookie("token", token).redirect("/");
    } else {
        return res.status(400).json({ error: "Invalid password" });
    }
});

// CREATE GROUP
app.get("/create", [verifyToken, redirectAnonymous], (req, res) => {
    res.render("create");
});
app.post("/create", [verifyToken, redirectAnonymous], (req, res) => {
    const { groupname: name, description } = req.body;
    createGroupStatement.run(name, description);
    // The below requires names to be unique
    addMemberStatement.run(req.decoded.uid, database.prepare("SELECT uid FROM groups WHERE name = ?").pluck().get(name));
    res.redirect("/group"+database.prepare("SELECT uid FROM groups WHERE name = ?").pluck().get(name));
});

// Within Group
app.get("/group/:id", [verifyToken, redirectAnonymous], (req, res) => {
    const group = findGroupStatement.get(req.params.id);
    if(!group)
        return res.status(400).json({ error: "Group not found" });
    const isMember = checkMembershipStatement.get(req.decoded.uid, req.params.id);
    if(!isMember)
        return res.status(403).json({ error: "You are not a member of this group" });

    const gifts = getGiftsAndUsersByGroupStatement.all(req.params.id, req.decoded.uid);
    const members = getGroupMembersStatement.all(req.params.id);
    const messages = getMessagesByGroupStatement.all(req.params.id);
    const pending = getPendngInvitesByGroup.all(req.params.id);
    res.render("group", { group, gifts, members: members.map(({uid, username})=>Object.assign({},{uid,username})), messages, uid: req.decoded.uid, pending, messages });
});
function getUsersInvites(uid){
    const invites = getUserGroupInviteStatement.all(uid);
    // VERY INEFFICIENT
    return invites.map(x=>
        Object.assign({invitee: getUserById.get(x.from_)},x)
    );
}
app.get("/invites", [verifyToken, redirectAnonymous], (req, res) => {
    const invites = getUsersInvites(req.decoded.uid);
    res.render("invites", { invites });
});
app.post("/invite", [verifyToken, redirectAnonymous], (req, res)=>{
    const isMember = checkMembershipStatement.get(req.decoded.uid, req.body.group_id);
    if(!isMember)
        return res.status(403).json({ error: "You are not a member of this group" });
    const user = findUserByEmailStatement.get(req.body.email);
    if(!user)
        return res.status(400).json({ error: "User not found" }); // TODO: add support to invite non-users
    const invite = getInviteStatement.get(req.decoded.uid, user.uid, parseInt(req.body.group_id));
    if(invite){
        return res.status(400).json({ error: "Invite already sent" });
    }
    inviteUserStatement.run(req.decoded.uid, user.uid, req.body.group_id);
    res.redirect("/group/"+req.body.group_id); // TODO: check if SQL was successful
});
app.get("/accept/:id", [verifyToken, redirectAnonymous], (req, res)=>{
    const invite = isInvitedStatement.get(req.decoded.uid, req.params.id);
    if(!invite)
        return res.status(400).json({ error: "Invite not found" });
    addMemberStatement.run(req.decoded.uid, invite.group_id);
    deleteInviteStatement.run(req.decoded.uid, invite.group_id);
    res.redirect("/group/"+invite.group_id);
});
// FIXME: Oh no hidden SQL
const cancelInviteStatement = database.prepare("DELETE FROM invites WHERE from_ = ? AND to_ = ? AND group_id = ?");
app.get("/cancel/:group_id/:user_id", [verifyToken, redirectAnonymous], (req, res)=>{
    cancelInviteStatement.run(req.decoded.uid, req.params.user_id, req.params.group_id);
    res.redirect("/group/"+req.params.group_id);
});
app.get("/decline/:id", [verifyToken, redirectAnonymous], (req, res)=>{
    res.json({success: false, error: "???"});
});
app.get("/leave/:id", [verifyToken, redirectAnonymous], (req, res)=>{
    const isMember = checkMembershipStatement.get(req.decoded.uid, req.params.id);
    if(!isMember)
        return res.status(403).json({ error: "You are not a member of this group" });
    deleteMembershipStatement.run(req.decoded.uid, req.params.id);
    database.prepare("DELETE FROM gifts WHERE (to_ = ? OR from_ = ?) AND group_id = ?").run(req.decoded.uid, req.decoded.uid, req.params.id);
    database.prepare("DELETE FROM messages WHERE (to_ = ? OR from_ = ?) AND group_id = ?").run(req.decoded.uid, req.decoded.uid, req.params.id);
    // Delete all traces of user in group
    res.redirect("/");
});
app.get("/join/:invite_id", [verifyToken, redirectAnonymous], (req, res)=>{
    if(!req.params.invite_id)
        return res.status(400).json({success: false, error: "Bad parameter"})
    const group = getGroupByInviteId.get(req.params.invite_id);
    if(!group)
        return res.status(400).json({success: false, error: "Group not found"})
    const isMember = checkMembershipStatement.get(req.decoded.uid, group.uid);
    if(isMember)
        return res.status(400).json({success: false, error: "You are already a member of this group"})
    addMemberStatement.run(req.decoded.uid, group.uid);
    res.redirect(`/group/${group.uid}`)
})
// MESSAGES
app.post("/message/:group_id", [verifyToken, redirectAnonymous], (req, res)=>{
    if(!req.params.group_id)
        return res.status(400).json({success: false, error: "Bad parameter"})
    const group = findGroupStatement.get(req.params.group_id);
    if(!group)
        return res.status(400).json({success: false, error: "Group not found"})
    const isMember = checkMembershipStatement.get(req.decoded.uid, group.uid);
    if(!isMember)
        return res.status(403).json({success: false, error: "You are not a member of this group"})
    const { message } = req.body;
    createMessageStatement.run(req.decoded.uid, group.uid, message);
    res.redirect(`/group/${group.uid}`)
});
// GIFTS
app.post("/dibs", [verifyToken, redirectAnonymous], (req, res)=>{
    const { gift_name: title, gift_description: description, link, for_, group_id } = req.body;
    const isSenderMember = checkMembershipStatement.get(req.decoded.uid, group_id);
    const isRecipientMember = checkMembershipStatement.get(for_, group_id);
    if(!isSenderMember || !isRecipientMember)
        return res.status(403).json({ error: "You are not a member of this group or the recipient is not a member of this group" });
    createGiftStatement.run(req.decoded.uid, for_, group_id, title, description, link);
    res.redirect("/group/"+group_id);
});
app.post("/update/dibs/:id", [verifyToken, redirectAnonymous], (req, res)=>{
    const gift = getGiftById.get(req.params.id);
    if(!gift)
        return res.status(400).json({ error: "Gift not found" });
    if(req.decoded.uid != gift.from_)
        return res.status(403).json({ error: "You are not the owner of this gift" });
    const { name: title, description, link } = req.body;
    updateGiftStatement.run(title, description, link, req.params.id);
    res.redirect(`/`);
});
app.get("/generate-invite/:id", [verifyToken, redirectAnonymous], (req, res)=>{
    if(!req.params.id)
        return res.status(400).json({success: false, error: "Bad parameter"})
    const group = findGroupStatement.get(req.params.id);
    if (!group)
        return res.status(400).json({success: false, error: "Group not found"})
    const isMember = checkMembershipStatement.get(req.decoded.uid, group.uid);
    if (!isMember)
        return res.status(403).json({success: false, error: "You are not a member of this group"})
    giveGroupInviteId.run(req.params.id, req.params.id);
    res.redirect("/group/"+req.params.id);
});
app.post("/delete/dibs/:id", [verifyToken, redirectAnonymous], (req, res)=>{
    const gift = getGiftById.get(req.params.id);
    if(!gift)
        return res.status(400).json({ error: "Gift not found" });
    if(req.decoded.uid != gift.from_)
        return res.status(403).json({ error: "You are not the owner of this gift" });
    deleteGiftById.run(req.params.id);
    res.json({ success: true });
});

app.get("/", [verifyToken, redirectAnonymous], (req, res) => {
    const groups = getUsersGroupsStatement.all(req.decoded.uid);
    const gifts = getOutgoingGifts.all(req.decoded.uid);
    const invites = getUsersInvites(req.decoded.uid);
    res.render("index", {
        message: "Hello world!",
        groups, gifts, invites
    });
});

// TODO: make redirectAnonymous treat POST requests differently

app.listen(PORT, HOST, () => {
    console.log(`Listening on http://${HOST}:${PORT}`);
});

// db.function('add2', (a, b) => a + b);

// db.prepare
// aggregate

// db.prepare("INSERT INTO sums VALUES (@a, @b, add2(@a, @b))").run({ a: 3, b: 4 }); <- example
// db.prepare('SELECT add2(?, ?)').get(12, 4); // => 16
// functions have a .length in js !!!