const socket = io();
socket.on("connect", () => {
    getCookie("token") && socket.emit("authenticate", {token: getCookie("token")});
    socket.on("auth", ({success}) => {
        if(!success)
            return console.error("Authentication failed");
        socket.emit("join", {group_id});
    });
    socket.on("send", data=>{
        console.table(data);
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