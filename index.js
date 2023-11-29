const path = require("path");
require("dotenv/config");

const DEBUG = false;
const DB_PERFORMANCE_MODE = false
const DB_LOG = false;

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
database.prepare("CREATE TABLE IF NOT EXISTS users (uid INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, email TEXT, password TEXT)").run();
database.prepare("CREATE TABLE IF NOT EXISTS groups (uid INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, description TEXT)").run();
database.prepare("CREATE TABLE IF NOT EXISTS gifts (uid INTEGER PRIMARY KEY AUTOINCREMENT, from_ INTEGER, to_ INTEGER, group_id INTEGER, title TEXT, description TEXT, link TEXT)").run();
database.prepare("CREATE TABLE IF NOT EXISTS membership (uid INTEGER PRIMARY KEY AUTOINCREMENT, user INTEGER, group_id INTEGER)").run();
database.prepare("CREATE TABLE IF NOT EXISTS messages (uid INTEGER PRIMARY KEY AUTOINCREMENT, from_ INTEGER, group_id INTEGER, message TEXT)").run();
database.prepare("CREATE TABLE IF NOT EXISTS invites (uid INTEGER PRIMARY KEY AUTOINCREMENT, from_ INTEGER, to_ INTEGER, group_id INTEGER)").run();
// STATEMENTS
// TODO: research joins
const createGroupStatement = database.prepare("INSERT INTO groups (name, description) VALUES (?, ?)");
const createGiftStatement = database.prepare("INSERT INTO gifts (from_, to_, group_id, title, description, link) VALUES (?, ?, ?, ?, ?, ?)");
const createMembershipStatement = database.prepare("INSERT INTO membership (user, group_id) VALUES (?, ?)");
const createMessageStatement = database.prepare("INSERT INTO messages (from_, group_id, message) VALUES (?, ?, ?)");
const createUserStatement = database.prepare("INSERT INTO users (username, email, password) VALUES (?, ?, ?)");

const findUserByEmailStatement = database.prepare("SELECT * FROM users WHERE email = ?");
const getUserById = database.prepare("SELECT * FROM users WHERE uid = ?");
const findGroupStatement = database.prepare("SELECT * FROM groups WHERE uid = ?");
const getGroupMessagesStatement = database.prepare("SELECT * FROM messages WHERE group_id = ?");
const getGroupMembersStatement = database.prepare("SELECT * FROM users WHERE uid IN (SELECT user FROM membership WHERE group_id = ?)");

const getGiftsByGroupStatement = database.prepare("SELECT * FROM gifts WHERE group_id = ?");
const getGiftsByGroupNotUser = database.prepare("SELECT * FROM gifts WHERE group_id = ? AND to_ != ?");
const getOutgoingGifts = database.prepare("SELECT * FROM users JOIN gifts ON gifts.to_ = users.uid WHERE from_ = ?");
const getGiftsAndUsersByGroupStatement = database.prepare("SELECT gifts.uid, gifts.from_, gifts.to_, gifts.group_id, gifts.title, gifts.description, gifts.link, to_.username as 'to', from_.username as 'from' FROM gifts JOIN users to_ ON gifts.to_ = to_.uid JOIN users from_ ON gifts.from_ = from_.uid WHERE gifts.group_id = ? AND gifts.to_ != ?");
const getGiftById = database.prepare("SELECT * FROM gifts WHERE uid = ?");
const deleteGiftById = database.prepare("DELETE FROM gifts WHERE uid = ?");
const updateGiftStatement = database.prepare("UPDATE gifts SET title = ?, description = ?, link = ? WHERE uid = ?");

const addMemberStatement = database.prepare("INSERT INTO membership (user, group_id) VALUES (?, ?)");
const getUsersMembershipsStatement = database.prepare("SELECT group_id FROM membership WHERE user = ?");
const getUsersGroupsStatement = database.prepare("SELECT * FROM groups WHERE uid IN (SELECT group_id FROM membership WHERE user = ?)");
const checkMembershipStatement = database.prepare("SELECT * FROM membership WHERE user = ? AND group_id = ?");
const deleteMembershipStatement = database.prepare("DELETE FROM membership WHERE user = ? AND group_id = ?");

const inviteUserStatement = database.prepare("INSERT INTO invites (from_, to_, group_id) VALUES (?, ?, ?)");
const deleteInviteStatement = database.prepare("DELETE FROM invites WHERE uid = ?");
const getInviteStatement = database.prepare("SELECT * FROM invites WHERE to_ = ? AND group_id = ?");
const getUserGroupInviteStatement = database.prepare("SELECT invites.uid, invites.from_, invites.to_, invites.group_id, groups.name, groups.description FROM invites JOIN groups ON invites.group_id = groups.uid WHERE invites.to_ = ?");
const getPendngInvitesByGroup = database.prepare("SELECT * FROM invites WHERE group_id = ?");
// TODO: Add messages last


// REGISTER AND LOGIN
function registerUser(username, email, password) {
    const user = database.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if(user){
        return [false, "Username already taken"];
    }
    const hashedPassword = bcrypt.hashSync(password, 10);
    database.prepare("INSERT INTO users (username, email, password) VALUES (?, ?, ?)").run(username, email, hashedPassword);
    if (DEBUG) console.log(`Registered user ${username} with email ${email} and password ${password}`);
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


app.get("/", [verifyToken, redirectAnonymous], (req, res) => {
    const groups = getUsersGroupsStatement.all(req.decoded.uid);
    const gifts = getOutgoingGifts.all(req.decoded.uid);
    res.render("index", {
        message: "Hello world!",
        groups, gifts
    });
});

// CREATE GROUP
app.get("/create", [verifyToken, redirectAnonymous], (req, res) => {
    res.render("create");
});
app.post("/create", [verifyToken, redirectAnonymous], (req, res) => {
    const { groupname: name, description } = req.body;
    createGroupStatement.run(name, description);
    addMemberStatement.run(req.decoded.uid, database.prepare("SELECT uid FROM groups WHERE name = ?").pluck().get(name));
    res.json({ success: true });
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
    const messages = getGroupMessagesStatement.all(req.params.id);
    res.render("group", { group, gifts, members: members.map(({uid, username})=>Object.assign({},{uid,username})), messages, uid: req.decoded.uid });
});
app.get("/invites", [verifyToken, redirectAnonymous], (req, res) => {
    const invites = getUserGroupInviteStatement.all(req.decoded.uid);
    res.render("invites", { invites: invites.map(x=>
        Object.assign({invitee: getUserById.get(x.from_)},x)
    )});
});
app.post("/invite", [verifyToken, redirectAnonymous], (req, res)=>{
    const isMember = checkMembershipStatement.get(req.decoded.uid, req.body.group_id);
    if(!isMember)
        return res.status(403).json({ error: "You are not a member of this group" });
    const user = findUserByEmailStatement.get(req.body.email);
    if(!user)
        return res.status(400).json({ error: "User not found" }); // TODO: add support to invite non-users
    
    const invite = getInviteStatement.get(req.decoded.uid, user.uid);
    if(invite){
        return res.status(400).json({ error: "Invite already sent" });
    }
    inviteUserStatement.run(req.decoded.uid, user.uid, req.body.group_id);
    res.json({ success: true }); // TODO: heck if SQL was successful
});
app.get("/accept/:id", [verifyToken, redirectAnonymous], (req, res)=>{
    const invite = getInviteStatement.get(req.decoded.uid, req.params.id);
    if(!invite)
        return res.status(400).json({ error: "Invite not found" });
    deleteInviteStatement.run(invite.uid);
    addMemberStatement.run(req.decoded.uid, invite.group_id);
    res.json({success: true});
});
app.get("/decline/:id", [verifyToken, redirectAnonymous], (req, res)=>{
    res.json({success: false, error: "???"});
});
app.get("/leave/:id", [verifyToken, redirectAnonymous], (req, res)=>{
    const isMember = checkMembershipStatement.get(req.decoded.uid, req.params.id);
    if(!isMember)
        return res.status(403).json({ error: "You are not a member of this group" });
    deleteMembershipStatement.run(req.decoded.uid, req.params.id);
    database.prepare("DELETE FROM gifts WHERE (to_ = ? OR from_ = ?) AND group_id = ?").run(req.decoded.uid, req.params.id);
    database.prepare("DELETE FROM messages WHERE (to_ = ? OR from_ = ?) AND group_id = ?").run(req.decoded.uid, req.params.id);
    // Delete all traces of user in group
    res.json({success: true});
});

// GIFTS
app.post("/dibs", [verifyToken, redirectAnonymous], (req, res)=>{
    const { gift_name: title, gift_description: description, link, for_, group_id } = req.body;
    const isSenderMember = checkMembershipStatement.get(req.decoded.uid, group_id);
    const isRecipientMember = checkMembershipStatement.get(for_, group_id);
    if(!isSenderMember || !isRecipientMember)
        return res.status(403).json({ error: "You are not a member of this group or the recipient is not a member of this group" });
    createGiftStatement.run(req.decoded.uid, for_, group_id, title, description, link);
    res.json({ success: true });
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
app.post("/delete/dibs/:id", [verifyToken, redirectAnonymous], (req, res)=>{
    const gift = getGiftById.get(req.params.id);
    if(!gift)
        return res.status(400).json({ error: "Gift not found" });
    if(req.decoded.uid != gift.from_)
        return res.status(403).json({ error: "You are not the owner of this gift" });
    deleteGiftById.run(req.params.id);
    res.json({ success: true });
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