
const fs = require('fs');
const https = require('https')
const express = require('express');
const app = express();
const socketio = require('socket.io');
app.use(express.static(__dirname))

//we need a key and cert to run https
//we generated them with mkcert
// $ mkcert create-ca
// $ mkcert create-cert
const key = fs.readFileSync('cert.key');
const cert = fs.readFileSync('cert.crt');

//we changed our express setup so we can use https
//pass the key and cert to createServer on https
const expressServer = https.createServer({key, cert}, app);
//create our socket.io server... it will listen to our express port
const io = socketio(expressServer,{
    cors: {
        origin: [
            "https://localhost",
            "https://abdelilah1223.github.io/webrtc-starter/",
            // 'https://LOCAL-DEV-IP-HERE' //if using a phone or another computer
        ],
        methods: ["GET", "POST"]
    }
});
expressServer.listen(8181);

//offers will contain {}
const offers = [
    // offererUserName
    // offer
    // offerIceCandidates
    // answererUserName
    // answer
    // answererIceCandidates
];
const connectedSockets = [
    //username, socketId
]

io.on('connection',(socket)=>{
    // console.log("Someone has connected");
    const userName = socket.handshake.auth.userName;
    const password = socket.handshake.auth.password;

    if(password !== "x"){
        socket.disconnect(true);
        return;
    }
    connectedSockets.push({
        socketId: socket.id,
        userName
    })

    //a new client has joined. If there are any offers available,
    //emit them out
    socket.emit('availableOffers',offers); // Send all current offers to the new client
    io.emit('connectedUsers', connectedSockets.map(s => s.userName)); // Send updated user list to all clients

    socket.on('newOffer',newOffer=>{
        // Check if user already has an active offer
        const existingOffer = offers.find(o => o.offererUserName === userName);
        if (existingOffer) {
            // Optionally, notify the user that they already have an active offer
            // For now, we'll just log it and not create a new one.
            // Or, we could replace the old offer. For simplicity, let's prevent multiple offers.
            console.log(`User ${userName} already has an active offer. New offer not created.`);
            socket.emit('offerError', { message: "You already have an active offer. Please cancel it before creating a new one." });
            return;
        }

        const offer = {
            offererUserName: userName,
            offer: newOffer, // This is the SDP offer
            offerIceCandidates: [],
            answererUserName: null,
            answer: null, // SDP answer
            answererIceCandidates: []
        };
        offers.push(offer);

        console.log(`New offer created by ${userName}`);
        //send out the new offer to all other connected sockets
        socket.broadcast.emit('newOfferAwaiting',[offer]); // Send as an array for consistency with availableOffers
    })

    socket.on('newAnswer',(offerObj,ackFunction)=>{
        console.log("New answer received", offerObj);
        const offerer = connectedSockets.find(s=>s.userName === offerObj.offererUserName);
        if(!offerer){
            console.log("No matching offerer socket found for user:", offerObj.offererUserName);
            return;
        }
        const offererSocketId = offerer.socketId;

        const offerIndex = offers.findIndex(o=>o.offererUserName === offerObj.offererUserName && !o.answererUserName);
        if(offerIndex === -1){
            console.log("No OfferToUpdate or offer already taken");
            // Optionally, inform the client that the offer is no longer available
            // ackFunction({error: "Offer no longer available"});
            return;
        }

        // Send back to the answerer all the ICE candidates we have already collected for the offer
        ackFunction(offers[offerIndex].offerIceCandidates);

        offers[offerIndex].answer = offerObj.answer;
        offers[offerIndex].answererUserName = userName; // userName of the answerer (current socket)

        // Emit the answer to the offerer
        socket.to(offererSocketId).emit('answerResponse',offers[offerIndex]);

        // Remove the offer from available offers as it's now taken
        // Or mark it as connected. For simplicity, let's remove it.
        // To ensure other clients get updated list of offers:
        const updatedOffer = offers.splice(offerIndex, 1)[0]; // Remove the offer
        io.emit('offerTaken', updatedOffer); // Inform all clients that this offer is taken
        console.log(`Offer between ${updatedOffer.offererUserName} and ${updatedOffer.answererUserName} is now active.`);
    })

    socket.on('sendIceCandidateToSignalingServer',iceCandidateObj=>{
        const { didIOffer, iceUserName, iceCandidate, recipientUserName } = iceCandidateObj; // Added recipientUserName for direct calls

        if (recipientUserName) { // Direct ICE candidate exchange
            const recipientSocket = connectedSockets.find(s => s.userName === recipientUserName);
            if (recipientSocket) {
                socket.to(recipientSocket.socketId).emit('receivedIceCandidateFromServer', iceCandidate);
            } else {
                console.log(`ICE candidate for ${recipientUserName} but user not found.`);
            }
            return;
        }

        // Below is the existing logic for offer/answer based ICE exchange
        let offer;
        if(didIOffer){
            //this ice is coming from the offerer. Send to the answerer
            offer = offers.find(o=>o.offererUserName === iceUserName);
            if(offer){
                offer.offerIceCandidates.push(iceCandidate);
                if(offer.answererUserName){
                    const answererSocket = connectedSockets.find(s=>s.userName === offer.answererUserName);
                    if(answererSocket){
                        socket.to(answererSocket.socketId).emit('receivedIceCandidateFromServer',iceCandidate);
                    }else{
                        console.log("Ice candidate received for offer, but answerer not found");
                    }
                }
            }
        }else{
            //this ice is coming from the answerer. Send to the offerer
            // Find the offer where this user is the answerer
            // Note: This logic might need adjustment if offers are removed immediately after connection.
            // For now, assuming the offer might still exist or this is for a direct call not using the 'offers' array.
            offer = offers.find(o=>o.answererUserName === iceUserName); // This might be problematic if offer is already removed.
                                                                      // Consider a more robust way to find the peer if not using direct calls.
            if (offer) { // Found an offer this user answered
                 const offererSocket = connectedSockets.find(s=>s.userName === offer.offererUserName);
                 if(offererSocket){
                     socket.to(offererSocket.socketId).emit('receivedIceCandidateFromServer',iceCandidate);
                 }else{
                     console.log("Ice candidate received for answer, but offerer not found");
                 }
            } else {
                 // Fallback or error: couldn't find an offer this user answered, and it's not a direct call.
                 console.log(`Ice candidate from answerer ${iceUserName}, but no matching offer or direct call recipient.`);
            }
        }
    });

    socket.on('callUser', (data) => {
        const { targetUserName } = data;
        const callingUser = connectedSockets.find(s => s.socketId === socket.id);
        if (!callingUser) return; // Should not happen

        const targetSocket = connectedSockets.find(s => s.userName === targetUserName);
        if (targetSocket) {
            console.log(`User ${callingUser.userName} is calling ${targetUserName}`);
            socket.to(targetSocket.socketId).emit('incomingCall', {
                fromUser: callingUser.userName
            });
        } else {
            // Inform caller that target user is not available
            socket.emit('callResponse', { success: false, message: `User ${targetUserName} is not online.` });
        }
    });

    socket.on('directOffer', (data) => {
        const { offer, targetUserName } = data;
        const offerer = connectedSockets.find(s => s.socketId === socket.id);
        if (!offerer) return;

        const targetSocket = connectedSockets.find(s => s.userName === targetUserName);
        if (targetSocket) {
            console.log(`Forwarding direct offer from ${offerer.userName} to ${targetUserName}`);
            socket.to(targetSocket.socketId).emit('offerReceived', {
                offer,
                offererUserName: offerer.userName
            });
        } else {
            console.log(`Cannot forward direct offer to ${targetUserName}, user not found.`);
        }
    });

    socket.on('directAnswer', (data) => {
        const { answer, targetUserName } = data;
        const answerer = connectedSockets.find(s => s.socketId === socket.id);
        if (!answerer) return;

        const targetSocket = connectedSockets.find(s => s.userName === targetUserName);
        if (targetSocket) {
            console.log(`Forwarding direct answer from ${answerer.userName} to ${targetUserName}`);
            socket.to(targetSocket.socketId).emit('answerReceived', {
                answer,
                answererUserName: answerer.userName
            });
        } else {
            console.log(`Cannot forward direct answer to ${targetUserName}, user not found.`);
        }
    });

    socket.on('disconnect', () => {
        console.log(`User ${userName} disconnected - Socket ID: ${socket.id}`);
        const index = connectedSockets.findIndex(s => s.socketId === socket.id);
        if (index !== -1) {
            connectedSockets.splice(index, 1);
            console.log('Removed from connectedSockets:', userName);
        }

        // Remove offers made by the disconnected user
        const offersMadeByDisconnectedUser = offers.filter(offer => offer.offererUserName === userName);
        offersMadeByDisconnectedUser.forEach(offer => {
            const offerIndex = offers.indexOf(offer);
            if (offerIndex !== -1) {
                offers.splice(offerIndex, 1);
                console.log(`Removed offer from ${userName}`);
                // Notify other clients that this offer is no longer available
                io.emit('offerRemoved', offer);
            }
        });

        // Handle cases where the disconnected user was an answerer in an ongoing call or accepted offer
        // This part is tricky if offers are removed immediately upon connection.
        // If we want to notify the offerer that the answerer disconnected:
        offers.forEach((offer, idx) => {
            if (offer.answererUserName === userName) {
                console.log(`User ${userName} (answerer) disconnected from an offer with ${offer.offererUserName}`);
                const offererSocket = connectedSockets.find(s => s.userName === offer.offererUserName);
                if (offererSocket) {
                    // Notify the offerer that the answerer has left
                    socket.to(offererSocket.socketId).emit('peerDisconnected', { peerUserName: userName });
                }
                // Make the offer available again or remove it
                // For simplicity, let's assume the call ends. If the offer should become available:
                // offers[idx].answererUserName = null;
                // offers[idx].answer = null;
                // io.emit('availableOffers', offers); // or a specific update
                // For now, let's consider the call ended. The offerer might need to re-initiate.
                // If offers are removed upon connection, this specific case (answerer disconnects from active call)
                // would need a different tracking mechanism (e.g., active an array of active calls).
            }
        });
        io.emit('availableOffers', offers); // Send updated offers list
        io.emit('connectedUsers', connectedSockets.map(s => s.userName)); // Send updated user list
    });
})
