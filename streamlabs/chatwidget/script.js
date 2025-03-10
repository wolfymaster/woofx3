let chat = document.getElementById('chat');
let chat_copy = document.getElementById('chat_copy');

// Please use event listeners to run functions.
document.addEventListener('onLoad', function (obj) {
	copyLastChat()
});

document.addEventListener('onEventReceived', function (obj) {
  // immediately add to chat_copy
  copyLastChat(chat, chat_copy);
  
  // only keep recent chat
//  keepRecentMessages(chat, 20);
//  keepRecentMessages(chat_copy, 20);
});

function copyLastChat(fromElem, toElem) {
  let lastElem = fromElem.lastElementChild;
  let clone = lastElem.cloneNode(true);
  
  setTimeout(() => {
  	// remove elem
    lastElem.remove();
    clone.remove();
  }, 65 * 1000);  
  
  toElem.appendChild(clone);
}

function keepRecentMessages (messageList, amountToKeep = 5) {
  while (messageList.children.length > amountToKeep) {
    messageList.removeChild(messageList.firstElementChild)
  }
}

function log(thing) {
  let logElem = document.getElementById('log');
  logElem.innerText = JSON.stringify(thing);
}