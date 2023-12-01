const socket = io();
// function getCookie(name) {
//     const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
//     return match ? match[2] : null;
// }
function authenticateSocket(socket, token){
    if(token){
        socket.emit("authenticate", {token});
        return;
    }
    getCookie("token") && socket.emit("authenticate", {token: getCookie("token")});
}
socket.on("connect", () => {
    let authAttempts = 1;
    authenticateSocket(socket);
    socket.on("auth", ({success}) => {
        if(success){
            console.info("Successfully authenticated socket");
            return socket.emit("join", {group_id});
        }
        console.error("Authentication failed");
        console.info("Attempting to re-authenticate");
        authenticateSocket(socket);
        if(authAttempts++ > 3){
            console.error("Failed to authenticate after 3 attempts");
            window.location = "/login";
            return socket.disconnect();
        }
    });
    socket.on("send", data=>{
        console.table(data);
    });
    socket.on("join", data=>{
        if(data.success) return console.info(`Successfully joined group ${group_id}`);
        console.error("Failed to join group", data.error);
    });
    socket.on("new_message", data=>{
        const new_message = document.createElement("p");
        const bold = document.createElement("b");
        bold.textContent = data.from;
        new_message.appendChild(bold);
        new_message.append(document.createTextNode(`: ${data.message}`));
        document.getElementById("messages").appendChild(new_message);
        scrollTo(0, document.body.scrollHeight);
    })
});
document.forms.messageForm.addEventListener("submit", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const message = document.forms.messageForm.message.value;
    document.forms.messageForm.message.value = "";
    socket.emit("new_message", {message, group_id});
});