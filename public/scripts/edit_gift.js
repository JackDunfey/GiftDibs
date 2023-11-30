[...document.getElementsByClassName('edit')].forEach(elem=>{
    elem.addEventListener('click',(e)=>{
        const container = e.target.parentElement;
        const editform = document.forms[0];
        editform.action = `/update/dibs/${container.dataset.giftid}`;
        editform.elements.name.value = container.dataset.name;
        editform.elements.description.value = container.dataset.description;
        editform.elements.link.value = container.dataset.link;
        editform.style.display = "block";
        console.log(container.dataset.giftid);
    });
});
[...document.getElementsByClassName('delete')].forEach(elem=>{
    elem.addEventListener('click',(e)=>{
        const container = e.target.parentElement;
        fetch(`/delete/dibs/${container.dataset.giftid}`, {method: "POST"}).then(res=>res.json()).then(data=>{
            if(data.success){
                container.remove();
            }
            console.log(data);
        });
    });
});