
const answerDiv = document.querySelector('#answer'); // Assuming this is where random offers are displayed
const connectedUsersList = document.querySelector('#connected-users-list'); // For the list of users

// Initial load: Get available random offers
socket.on('availableOffers',offers => {
    console.log("Available random offers:", offers);
    updateAvailableOffersUI(offers);
});

// A new random offer is available
socket.on('newOfferAwaiting', offers => { // server sends it as an array
    console.log("New random offer awaiting:", offers);
    updateAvailableOffersUI(offers, true); // Append new offer
});

// This client's random offer was answered by someone
socket.on('answerResponse', offerObj => {
    console.log("Our random offer was answered:", offerObj);
    handleAnswer(offerObj); // This will set the remote description
    // UI update: disable call buttons, enable hangup
    callButton.disabled = true;
    directCallButton.disabled = true;
    if(hangUpButton) hangUpButton.disabled = false;
});

// Received an ICE candidate from the server (for either random or direct call)
socket.on('receivedIceCandidateFromServer', iceCandidate => {
    console.log("Received ICE candidate from server:", iceCandidate);
    addNewIceCandidate(iceCandidate);
});

// --- Direct Call Listeners ---

// Server's response to our 'callUser' request
socket.on('callResponse', data => {
    if (data.success) {
        // User is online, now we can decide to send an offer.
        // This might be automatic, or you might have another UI step.
        // For now, let's assume we proceed to make the offer.
        console.log(`${data.targetUserName} is online. Proceeding to make direct offer.`);
        // This was moved to a function `proceedWithDirectOffer` in scripts.js
        // It should be called if the user confirms or if it's automatic.
        // proceedWithDirectOffer(); // This should be called after peerConnection is ready.
        // Let's assume `makeDirectCall` already set up peerConnection.
        // We might need a state variable like `waitingToMakeOffer = true`
        // Or, this event could trigger the offer creation.
        // For simplicity now, let's assume `proceedWithDirectOffer` is called after user confirms or automatically.
        // The current `makeDirectCall` in `scripts.js` calls `socket.emit('callUser', ...)`
        // and then `proceedWithDirectOffer` needs to be triggered.
        // A better flow: `makeDirectCall` -> `socket.emit('callUser')`.
        // Server `callUser` -> `target.emit('incomingCall')`.
        // Target accepts -> `target.emit('acceptCall', {caller})`
        // Server `acceptCall` -> `caller.emit('callAcceptedByTarget', {target})`
        // THEN caller calls `proceedWithDirectOffer`.

        // For now, let's simplify: if user is online, we try to send offer.
        // This implies `makeDirectCall` should have already set up `peerConnection`.
        if (isDirectCall && currentTargetUserName === data.targetUserName) {
            proceedWithDirectOffer(); // Defined in scripts.js
        }

    } else {
        alert(data.message); // E.g., "User is not online."
        resetCall(); // Reset since the call cannot proceed
    }
});

// An incoming direct call for this client
socket.on('incomingCall', data => {
    const { fromUser } = data;
    console.log(`Incoming direct call from ${fromUser}`);
    if (confirm(`Incoming call from ${fromUser}. Do you want to accept?`)) {
        console.log("Call accepted. Waiting for their offer.");
        currentTargetUserName = fromUser; // The user we are now interacting with
        isDirectCall = true;
        // The caller (fromUser) will now send a 'directOffer' upon getting our acceptance (implicitly or explicitly)
        // For this example, the caller sends 'directOffer' after 'callUser' if target is online.
        // So, we just need to be ready for 'offerReceived'.
        // We might need to initialize peerConnection here if not already.
        // If `answerDirectOffer` handles PC creation, that's fine.
        // UI update: disable call buttons, enable hangup
        callButton.disabled = true;
        directCallButton.disabled = true;
        if(hangUpButton) hangUpButton.disabled = false;

    } else {
        console.log("Call rejected.");
        // Optionally, notify the caller that the call was rejected.
        // socket.emit('callRejected', { toUser: fromUser });
    }
});

// Received a direct offer from a user who called us (and we accepted via 'incomingCall' logic)
socket.on('offerReceived', offerData => {
    console.log("Direct offer received from:", offerData.offererUserName);
    answerDirectOffer(offerData); // This will create an answer and send 'directAnswer'
});

// Received a direct answer from the user we called
socket.on('answerReceived', answerData => {
    console.log("Direct answer received from:", answerData.answererUserName);
    handleAnswer(answerData); // This will set the remote description
    // UI update: disable call buttons, enable hangup
    callButton.disabled = true;
    directCallButton.disabled = true;
    if(hangUpButton) hangUpButton.disabled = false;
});


// --- General Offer Management Listeners ---

socket.on('offerError', error => {
    alert(`Offer Error: ${error.message}`);
});

// A random offer was taken by someone else, or we took it
socket.on('offerTaken', offerTaken => {
    console.log("Offer taken:", offerTaken);
    removeOfferFromUI(offerTaken.offererUserName);
});

// A random offer was removed (e.g., offerer disconnected)
socket.on('offerRemoved', offerRemoved => {
    console.log("Offer removed:", offerRemoved);
    removeOfferFromUI(offerRemoved.offererUserName);
});


// --- User List and Disconnection ---
socket.on('connectedUsers', users => {
    console.log("Connected users:", users);
    if (connectedUsersList) {
        connectedUsersList.innerHTML = ''; // Clear existing list
        users.forEach(user => {
            if (user !== clientUserName) { // Don't list self
                const li = document.createElement('li');
                li.textContent = user;
                // Optional: Add a button to call this user directly
                const callUserButton = document.createElement('button');
                callUserButton.textContent = 'Call';
                callUserButton.onclick = () => {
                    targetUserInput.value = user;
                    makeDirectCall();
                };
                li.appendChild(callUserButton);
                connectedUsersList.appendChild(li);
            }
        });
    }
});

socket.on('peerDisconnected', data => {
    alert(`User ${data.peerUserName} has disconnected from the call.`);
    resetCall(); // Clean up the call state
});


// --- UI Helper Functions for Random Offers ---
function updateAvailableOffersUI(offers, append = false) {
    if (!append && answerDiv) {
        answerDiv.innerHTML = ''; // Clear existing offers if not appending
    }
    offers.forEach(o => {
        // Avoid showing own offers or already answered offers
        if (o.offererUserName === clientUserName || o.answererUserName) {
            return;
        }
        // Avoid duplicating if offer already exists in UI
        if (document.getElementById(`offer-${o.offererUserName}`)) {
            return;
        }

        const newOfferEl = document.createElement('div');
        newOfferEl.id = `offer-${o.offererUserName}`;
        newOfferEl.innerHTML = `<button class="btn btn-success col-1">Answer ${o.offererUserName}</button>`;
        newOfferEl.addEventListener('click', () => {
            console.log("Attempting to answer random offer from:", o.offererUserName);
            answerRandomOffer(o);
            // UI update: disable call buttons, enable hangup
            callButton.disabled = true;
            directCallButton.disabled = true;
            if(hangUpButton) hangUpButton.disabled = false;
        });
        if (answerDiv) {
            answerDiv.appendChild(newOfferEl);
        }
    });
}

function removeOfferFromUI(offererUserName) {
    const offerEl = document.getElementById(`offer-${offererUserName}`);
    if (offerEl) {
        offerEl.remove();
    }
}

// Global error handler for socket.io connection issues
socket.on("connect_error", (err) => {
  console.error(`Socket connection error: ${err.message}`);
  alert("Failed to connect to the signaling server. Please check your connection or try again later.");
});