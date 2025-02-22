const container = document.getElementById('headingContainer');

const tabs = document.querySelectorAll('[id^="tab"]');

container.addEventListener('click', (evt) => {
    // get tab id of clicked tab
    const tabId = evt.target.dataset.tabid;

    // make that tab active
    const tab = document.getElementById(`tab${tabId}`);

    Array.from(tabs).forEach(t => t.style.display = 'none');

    tab.style.display = 'block';
})


let token = '';

window.Twitch.ext.onAuthorized(function (auth) {
    console.log(auth);
    token = auth.token;
    console.log('The Helix JWT is ', auth.helixToken);
});

async function btn() {
    const response = await fetch('http://localhost:3001/payload', {
        method: 'post',
        headers: {
            authorization: token,
        }
    });

    const payload = await response.json();

    console.log('payload', payload);
}

async function btn2() {
    console.log(window.parent.document);
}