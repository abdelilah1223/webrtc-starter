const clientUserName = "User-" + Math.floor(Math.random() * 100000);
const password = "x"; // Secure appropriately in a real app
document.querySelector('#user-name').innerHTML = clientUserName;

// Assuming railway.app URL or localhost for dev
const socket = io.connect('https://qr-production-06b7.up.railway.app:8181/', {
// const socket = io.connect('https://localhost:8181/',{ // For local testing with self-signed certs
    auth: {
        userName: clientUserName, password
    }
});

const localVideoEl = document.querySelector('#local-video');
const remoteVideoEl = document.querySelector('#remote-video');
const targetUserInput = document.querySelector('#target-username-input');
const directCallButton = document.querySelector('#direct-call-btn');
const callButton = document.querySelector('#call'); // Regular call button for random offers
const hangUpButton = document.querySelector('#hang-up-btn'); // Assuming a hang-up button exists or will be added

let localStream;
let remoteStream;
let peerConnection;
let didIOffer = false;
let currentTargetUserName; // For direct calls, to know who we are talking to or trying to call
let isDirectCall = false; // Flag to differentiate between random offer call and direct call

let peerConfiguration = {
    iceServers:[
        {
            urls:[
              'stun:stun.l.google.com:19302',
              'stun:stun1.l.google.com:19302'
            ]
        }
    ]
};

// Function to initiate a regular WebRTC offer (for random calls)
const makeRandomOffer = async () => {
    isDirectCall = false;
    await fetchUserMedia();
    await createPeerConnection(); // No offerObj needed for the offerer initially
    try {
        console.log("Creating random offer...");
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        didIOffer = true;
        socket.emit('newOffer', offer); //send offer to signalingServer
        console.log("Random offer sent.");
    } catch (err) {
        console.error("Error creating random offer:", err);
    }
};

// Function to initiate a direct call to a specific user
const makeDirectCall = async () => {
    const targetUserName = targetUserInput.value;
    if (!targetUserName || targetUserName === clientUserName) {
        alert("Please enter a valid username to call (not your own).");
        return;
    }
    console.log(`Attempting to call ${targetUserName}...`);
    isDirectCall = true;
    currentTargetUserName = targetUserName; // Store who we are calling

    await fetchUserMedia();
    await createPeerConnection(); // No offerObj initially

    // Inform server of intent to call
    socket.emit('callUser', { targetUserName });
    // The server will emit 'callResponse'. If successful, or if target accepts,
    // we then proceed to create and send the offer.
    // For now, let's assume we proceed to offer creation after 'callUser'
    // A better flow might wait for a 'userAvailable' or similar signal.

    // The actual offer sending will be triggered by a server response or user action
    // For now, let's create the offer and wait for 'incomingCallAccepted' or similar.
    // This part will be refined based on socketListeners.js logic for 'callResponse' or 'incomingCallAccepted'
};

// Called when this client wants to answer a random offer from the list
const answerRandomOffer = async (offerObj) => {
    isDirectCall = false;
    currentTargetUserName = offerObj.offererUserName; // The user who made the offer
    await fetchUserMedia();
    await createPeerConnection(offerObj); // Pass the offer to set remote description
    try {
        const answer = await peerConnection.createAnswer({});
        await peerConnection.setLocalDescription(answer);
        offerObj.answer = answer;

        console.log("Sending answer to random offer by:", offerObj.offererUserName);
        const offerIceCandidates = await socket.emitWithAck('newAnswer', offerObj);
        offerIceCandidates.forEach(c => {
            peerConnection.addIceCandidate(c);
            console.log("Added ICE Candidate from ack (random answer)");
        });
    } catch (err) {
        console.error("Error answering random offer:", err);
    }
};

// Called when this client receives a direct offer (from 'offerReceived' event)
const answerDirectOffer = async (offerData) => {
    isDirectCall = true;
    currentTargetUserName = offerData.offererUserName;
    console.log(`Answering direct call from ${currentTargetUserName}`);
    await fetchUserMedia();
    // Pass the received offer to createPeerConnection so it can setRemoteDescription
    await createPeerConnection({ offer: offerData.offer });
    try {
        const answer = await peerConnection.createAnswer({});
        await peerConnection.setLocalDescription(answer);
        console.log("Sending direct answer to:", currentTargetUserName);
        socket.emit('directAnswer', {
            answer,
            targetUserName: currentTargetUserName // Send answer back to the original offerer
        });
    } catch (err) {
        console.error("Error creating direct answer:", err);
    }
};


// Called when an offer is accepted (either random via 'answerResponse' or direct via 'answerReceived')
const handleAnswer = async (answerData) => {
    // answerData could be offerObj (from random) or { answer, answererUserName } (from direct)
    console.log("Answer received, setting remote description:", answerData);
    await peerConnection.setRemoteDescription(answerData.answer);
    console.log("Remote description set. Connection should be established soon.");
};

const fetchUserMedia = () => {
    return new Promise(async(resolve, reject)=>{
        try{
            const stream = await navigator.mediaDevices.getUserMedia({
                video: true,
                // audio: true,
            });
            localVideoEl.srcObject = stream;
            localStream = stream;    
            resolve();    
        }catch(err){
            console.log(err);
            reject()
        }
    })
}

const createPeerConnection = (offerObj)=>{
    return new Promise(async(resolve, reject)=>{
        //RTCPeerConnection is the thing that creates the connection
        //we can pass a config object, and that config object can contain stun servers
        //which will fetch us ICE candidates
        peerConnection = await new RTCPeerConnection(peerConfiguration)
        remoteStream = new MediaStream()
        remoteVideoEl.srcObject = remoteStream;


        localStream.getTracks().forEach(track=>{
            //add localtracks so that they can be sent once the connection is established
            peerConnection.addTrack(track,localStream);
        })

        peerConnection.addEventListener("signalingstatechange", (event) => {
            console.log(event);
            console.log(peerConnection.signalingState)
        });

        peerConnection.addEventListener('icecandidate',e => {
            console.log('........Ice candidate found!......');
            if(e.candidate){
                const icePayload = {
                    iceCandidate: e.candidate,
                    iceUserName: clientUserName, // The user sending this candidate
                    didIOffer, // Helps server route if it's part of a public offer
                };
                if (isDirectCall && currentTargetUserName) {
                    icePayload.recipientUserName = currentTargetUserName; // For direct calls
                }
                socket.emit('sendIceCandidateToSignalingServer', icePayload);
            }
        });
        
        peerConnection.addEventListener('track',e => {
            console.log("Got a track from the other peer!! How exciting");
            e.streams[0].getTracks().forEach(track => {
                remoteStream.addTrack(track, remoteStream);
            });
        });

        if(offerObj && offerObj.offer){ // If we are answering an offer (random or direct)
            // offerObj.offer will be the SDP offer from the other peer
            console.log("Setting remote description from received offer:", offerObj.offer);
            await peerConnection.setRemoteDescription(new RTCSessionDescription(offerObj.offer));
        }
        resolve();
    });
};

const addNewIceCandidate = iceCandidate => {
    if (peerConnection) {
        peerConnection.addIceCandidate(iceCandidate);
        console.log("======Added received ICE Candidate======");
    } else {
        console.warn("PeerConnection not ready, cannot add ICE candidate yet.");
        // Potentially queue candidates if this happens often
    }
};

const resetCall = () => {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    localVideoEl.srcObject = null;
    remoteVideoEl.srcObject = null;
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    if (remoteStream) {
        remoteStream.getTracks().forEach(track => track.stop());
        remoteStream = null;
    }
    didIOffer = false;
    isDirectCall = false;
    currentTargetUserName = null;
    // May need to inform the other peer about hang-up if in a call
    // socket.emit('hangUp', { targetUserName: currentTargetUserName }); // If implementing server-side hangup notification
    console.log("Call reset.");
    // Re-enable call buttons, disable hang-up, etc.
    callButton.disabled = false;
    directCallButton.disabled = false;
    if(hangUpButton) hangUpButton.disabled = true;
};


// Event listeners for buttons
callButton.addEventListener('click', makeRandomOffer);
directCallButton.addEventListener('click', makeDirectCall);
if(hangUpButton) {
    hangUpButton.addEventListener('click', resetCall);
    hangUpButton.disabled = true; // Initially disabled
}

// Initial setup or utilities
// Example: Function to create and send a direct offer *after* a call intent is accepted.
// This would be called from a socket listener, e.g., when 'callAcceptedByTarget' is received.
const proceedWithDirectOffer = async () => {
    if (!isDirectCall || !currentTargetUserName || !peerConnection) {
        console.error("Cannot proceed with direct offer: state is not correctly set up.");
        return;
    }
    try {
        console.log(`Creating direct offer for ${currentTargetUserName}...`);
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        didIOffer = true; // This client is the offerer in this direct call
        socket.emit('directOffer', {
            offer,
            targetUserName: currentTargetUserName
        });
        console.log(`Direct offer sent to ${currentTargetUserName}.`);
    } catch (err) {
        console.error("Error creating direct offer:", err);
        resetCall(); // Reset if offer creation fails
    }
};
