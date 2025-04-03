// --- Global Variables ---
let audioContext;
const tracks = {};
let masterGainNode;
const MARKER_CLICK_TOLERANCE = 5; // Pixels tolerance for clicking marker lines

// --- DOM Element References ---
const masterPlayPauseButton = document.getElementById('master-play-pause');
const masterVolumeSlider = document.getElementById('master-volume');

// --- Initialization ---
function initAudio() {
    try {
        window.AudioContext = window.AudioContext || window.webkitAudioContext;
        audioContext = new AudioContext();
        console.log("AudioContext initialized.");

        masterGainNode = audioContext.createGain();
        masterGainNode.gain.value = masterVolumeSlider.value;
        masterGainNode.connect(audioContext.destination);
        console.log("Master Gain Node created and connected.");

        console.log("Setting up Track 1...");
        setupTrack(1);
        console.log("Setting up Track 2...");
        setupTrack(2);

    } catch (e) {
        alert('Web Audio API is not supported in this browser');
        console.error("Error initializing AudioContext:", e);
    }
}

window.addEventListener('load', initAudio);

// --- Track Setup Function ---
function setupTrack(trackId) {
    if (!audioContext) {
        console.error(`Cannot setup Track ${trackId}: AudioContext not available.`);
        return;
    }

    const trackElement = document.getElementById(`track${trackId}`);
    if (!trackElement) {
        console.error(`Track element track${trackId} not found`);
        return;
    }

    const fileInput = document.getElementById(`file-input-${trackId}`);
    const fileNameDisplay = document.getElementById(`file-name-${trackId}`);
    const waveformCanvas = document.getElementById(`waveform-${trackId}`);
    const playPauseButton = document.getElementById(`play-pause-${trackId}`);
    const volumeSlider = document.getElementById(`volume-${trackId}`);
    const rateSlider = document.getElementById(`rate-${trackId}`);
    const rateValueDisplay = document.getElementById(`rate-value-${trackId}`);
    const loopToggle = document.getElementById(`loop-${trackId}`); // Get loop checkbox
    const canvasCtx = waveformCanvas.getContext('2d');

    tracks[trackId] = {
        id: trackId,
        buffer: null,
        sourceNode: null,
        gainNode: audioContext.createGain(),
        playbackRate: parseFloat(rateSlider.value),
        isPlaying: false,
        isLoaded: false,
        isLooping: loopToggle.checked, // Store loop state
        startTime: 0, // Time in seconds for start marker
        endTime: 0,   // Time in seconds for end marker (initially duration)
        draggingMarker: null, // 'start', 'end', or null
        isDragging: false,
        playPauseButton: playPauseButton,
        volumeSlider: volumeSlider,
        rateSlider: rateSlider,
        rateValueDisplay: rateValueDisplay,
        loopToggle: loopToggle, // Store toggle reference
        canvas: waveformCanvas,
        canvasCtx: canvasCtx,
        fileNameDisplay: fileNameDisplay
    };

    if (!masterGainNode) {
         console.error(`Cannot connect Track ${trackId} gain: Master Gain Node not available.`);
         return;
    }

    tracks[trackId].gainNode.gain.value = volumeSlider.value;
    tracks[trackId].gainNode.connect(masterGainNode);
    console.log(`Track ${trackId} Gain Node created and connected to Master Gain.`);

    // --- Event Listeners for the track ---
    fileInput.addEventListener('change', (event) => handleFileLoad(event, trackId));
    playPauseButton.addEventListener('click', () => togglePlayPause(trackId));
    volumeSlider.addEventListener('input', (event) => handleVolumeChange(event, trackId));
    rateSlider.addEventListener('input', (event) => handlePlaybackRateChange(event, trackId));
    loopToggle.addEventListener('change', (event) => handleLoopToggleChange(event, trackId)); // Listener for loop toggle

    // --- Canvas Interaction Listeners ---
    waveformCanvas.addEventListener('mousedown', (event) => handleCanvasMouseDown(event, trackId));
    waveformCanvas.addEventListener('mousemove', (event) => handleCanvasMouseMove(event, trackId));
    // Use window for mouseup to catch events outside canvas bounds during drag
    window.addEventListener('mouseup', (event) => handleCanvasMouseUp(event, trackId));
    waveformCanvas.addEventListener('mouseleave', (event) => handleCanvasMouseLeave(event, trackId));

}

// --- Master Control Event Listeners ---
masterVolumeSlider.addEventListener('input', (event) => {
    if (masterGainNode && audioContext) {
        masterGainNode.gain.linearRampToValueAtTime(
            parseFloat(event.target.value),
            audioContext.currentTime + 0.05
        );
    }
});

masterPlayPauseButton.addEventListener('click', toggleMasterPlayPause);

// --- Audio Loading ---
async function handleFileLoad(event, trackId) {
    if (!audioContext) {
        console.error("Cannot load file: AudioContext not ready.");
        alert("Audio system not initialized. Please refresh.")
        return;
    }
    if (audioContext.state === 'suspended') {
        await audioContext.resume();
        console.log("AudioContext resumed on file load.");
    }

    const file = event.target.files[0];
    if (!file) return;

    const track = tracks[trackId];
    track.fileNameDisplay.textContent = `Loading: ${file.name}...`;
    track.playPauseButton.disabled = true;
    track.playPauseButton.textContent = 'Play';
    track.canvas.classList.remove('interactive'); // Remove interactive cursor during load

    if (track.sourceNode && track.isPlaying) {
        try { track.sourceNode.stop(); } catch (e) {}
    }
    if (track.sourceNode) {
        track.sourceNode.disconnect();
        track.sourceNode = null;
    }
    track.isPlaying = false;
    track.isLoaded = false;
    track.buffer = null;
    track.startTime = 0; // Reset start time
    track.endTime = 0;   // Reset end time
    track.draggingMarker = null;
    track.isDragging = false;
    track.canvasCtx.fillStyle = '#282c34';
    track.canvasCtx.fillRect(0, 0, track.canvas.width, track.canvas.height);


    console.log(`Track ${trackId}: Reading file...`);
    try {
        const arrayBuffer = await file.arrayBuffer();
        console.log(`Track ${trackId}: Read success. Decoding...`);

        audioContext.decodeAudioData(arrayBuffer, (decodedBuffer) => {
            console.log(`Track ${trackId}: Decode SUCCESS`);
            track.buffer = decodedBuffer;
            track.isLoaded = true;
            track.playPauseButton.disabled = false;
            track.fileNameDisplay.textContent = file.name;
            // *** Set initial end time to buffer duration ***
            track.endTime = decodedBuffer.duration;
            console.log(`Track ${trackId} loaded: ${file.name}, duration: ${track.endTime.toFixed(2)}s`);
            drawWaveform(trackId); // Draw waveform AND initial markers
            checkMasterPlayEnable();
            track.canvas.classList.add('interactive'); // Make canvas interactive now

        }, (error) => {
            console.error(`Error decoding audio data for track ${trackId}:`, error);
            alert(`Error decoding file for Track ${trackId}. Format unsupported or file corrupted? Check Console (F12).`);
            track.fileNameDisplay.textContent = 'Load failed';
             track.playPauseButton.disabled = true;
        });
    } catch (error) {
        console.error(`Error reading file for track ${trackId}:`, error);
        alert(`Error reading file for Track ${trackId}.`);
        track.fileNameDisplay.textContent = 'Load failed';
        track.playPauseButton.disabled = true;
    }
}


// --- Waveform Drawing (Includes Markers) ---
function drawWaveform(trackId) {
    const track = tracks[trackId];
    if (!track.buffer || !track.canvasCtx || !track.canvas) {
        // console.warn(`Track ${trackId}: Cannot draw waveform, missing buffer, context, or canvas.`);
        // Clear canvas if no buffer
        if(track.canvasCtx && track.canvas){
            track.canvasCtx.fillStyle = '#282c34';
            track.canvasCtx.fillRect(0, 0, track.canvas.width, track.canvas.height);
        }
        return;
    };

    const buffer = track.buffer;
    const canvas = track.canvas;
    const ctx = track.canvasCtx;
    const width = canvas.width;
    const height = canvas.height;
    const duration = buffer.duration;

    // --- Draw Waveform Background ---
    ctx.fillStyle = '#282c34';
    ctx.fillRect(0, 0, width, height);

    // --- Draw Waveform Data ---
    if (buffer.numberOfChannels > 0 && buffer.length > 0) {
        const channelIndex = 0; // Use left channel
        const data = buffer.getChannelData(channelIndex);
        const step = Math.ceil(data.length / width);
        const amp = height / 2;

        ctx.lineWidth = 1;
        ctx.strokeStyle = '#61dafb'; // Waveform color
        ctx.beginPath();

        let x = 0;
        for (let i = 0; i < data.length; i += step) {
            let min = 1.0;
            let max = -1.0;
            for (let j = 0; j < step && i + j < data.length; j++) {
                const datum = data[i + j];
                if (datum < min) min = datum;
                if (datum > max) max = datum;
            }
            const yMin = Math.max(0, Math.min(height, amp + min * amp));
            const yMax = Math.max(0, Math.min(height, amp + max * amp));
            if (yMax <= yMin + 1) {
                ctx.moveTo(x + 0.5, yMin);
                ctx.lineTo(x + 0.5, yMin + 1);
            } else {
                ctx.moveTo(x + 0.5, yMin);
                ctx.lineTo(x + 0.5, yMax);
            }
            x++;
            if (x >= width) break;
        }
        ctx.stroke();
    } else {
        console.warn(`Track ${trackId}: Buffer has no data to draw.`);
        ctx.fillStyle = '#aaaaaa';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No Audio Data', width / 2, height / 2);
    }


    // --- Draw Start/End Markers ---
    if (track.isLoaded && duration > 0) {
        // Start Marker (Green)
        const startX = (track.startTime / duration) * width;
        ctx.strokeStyle = 'rgba(0, 255, 0, 0.8)'; // Green, slightly transparent
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(startX, 0);
        ctx.lineTo(startX, height);
        ctx.stroke();

        // End Marker (Red)
        const endX = (track.endTime / duration) * width;
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)'; // Red, slightly transparent
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(endX, 0);
        ctx.lineTo(endX, height);
        ctx.stroke();
    }

    // console.log(`Waveform drawn for track ${trackId}`); // Reduce console spam
}

// --- Canvas Interaction Handlers ---
function getMousePos(canvas, evt) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: evt.clientX - rect.left,
        y: evt.clientY - rect.top
    };
}

function getTimeFromX(x, canvasWidth, duration) {
    return Math.max(0, Math.min(duration, (x / canvasWidth) * duration));
}

function getMarkerAtX(x, track) {
    if (!track.isLoaded || !track.buffer) return null;
    const width = track.canvas.width;
    const duration = track.buffer.duration;
    if (duration <= 0) return null;

    const startX = (track.startTime / duration) * width;
    const endX = (track.endTime / duration) * width;

    if (Math.abs(x - startX) <= MARKER_CLICK_TOLERANCE) {
        return 'start';
    }
    if (Math.abs(x - endX) <= MARKER_CLICK_TOLERANCE) {
        return 'end';
    }
    return null;
}

function handleCanvasMouseDown(event, trackId) {
    const track = tracks[trackId];
    if (!track.isLoaded || !track.buffer || track.buffer.duration <= 0) return;

    const pos = getMousePos(track.canvas, event);
    const marker = getMarkerAtX(pos.x, track);

    if (marker) {
        track.draggingMarker = marker;
        track.isDragging = true;
        track.canvas.style.cursor = 'grabbing'; // Indicate grabbing
        console.log(`Track ${trackId}: Started dragging ${marker} marker.`);
    }
}

function handleCanvasMouseMove(event, trackId) {
    const track = tracks[trackId];
    if (!track.isLoaded || !track.buffer || track.buffer.duration <= 0) return;

    const pos = getMousePos(track.canvas, event);
    const duration = track.buffer.duration;

    if (track.isDragging && track.draggingMarker) {
        let newTime = getTimeFromX(pos.x, track.canvas.width, duration);

        // Apply constraints
        if (track.draggingMarker === 'start') {
            // Start time cannot go past end time (minus a tiny buffer to prevent overlap issues)
            newTime = Math.min(newTime, track.endTime - 0.001);
            track.startTime = Math.max(0, newTime); // Ensure startTime >= 0
        } else { // Dragging 'end'
            // End time cannot go before start time (plus a tiny buffer)
            newTime = Math.max(newTime, track.startTime + 0.001);
            track.endTime = Math.min(duration, newTime); // Ensure endTime <= duration
        }

        drawWaveform(trackId); // Redraw with new marker position

        // OPTIONAL: If playing, update loop points immediately (requires stop/start)
        // Uncomment if you want immediate effect while dragging
        // if (track.isPlaying) {
        //     stopAndRestartPlayback(trackId);
        // }

    } else {
        // Update cursor if hovering over a marker when not dragging
        const marker = getMarkerAtX(pos.x, track);
        if (marker) {
            track.canvas.style.cursor = 'ew-resize'; // Left-right arrow
        } else {
            track.canvas.style.cursor = 'default';
        }
    }
}

function handleCanvasMouseUp(event, trackId) {
    const track = tracks[trackId];
    // Check if dragging was active *for this track* before resetting
    if (track && track.isDragging) {
        console.log(`Track ${trackId}: Finished dragging ${track.draggingMarker} marker.`);
        track.isDragging = false;
        track.draggingMarker = null;
        track.canvas.style.cursor = 'default'; // Reset cursor

        // If playing, restart playback now with the final marker positions
        if (track.isPlaying) {
            console.log(`Track ${trackId}: Restarting playback after marker drag.`);
            stopAndRestartPlayback(trackId);
        }
    }
     // Reset cursor for other tracks if mouseup happens over window
     Object.values(tracks).forEach(t => {
         if (t.canvas && !t.isDragging) t.canvas.style.cursor = 'default';
     });
}

function handleCanvasMouseLeave(event, trackId) {
    const track = tracks[trackId];
    // Don't reset cursor if actively dragging
    if (track && !track.isDragging) {
         track.canvas.style.cursor = 'default'; // Reset cursor if mouse leaves canvas while not dragging
    }
}

// Helper to stop and restart playback (useful after changing loop/rate/markers)
function stopAndRestartPlayback(trackId) {
    const track = tracks[trackId];
    if (track && track.isPlaying) {
        _performTogglePlayPause(trackId); // Stop
        // Use setTimeout to allow the 'stop' action to fully process before starting again
        setTimeout(() => {
             if (track.isLoaded) { // Check if still valid
                 _performTogglePlayPause(trackId); // Start again with new settings
             }
        }, 10); // Small delay
    }
}


// --- Playback Control ---
function togglePlayPause(trackId) {
    if (!audioContext || !tracks[trackId] || !tracks[trackId].isLoaded) {
        console.warn(`Track ${trackId}: Cannot toggle play/pause - context or track not ready.`);
        return;
    }

    if (audioContext.state === 'suspended') {
        console.log(`Track ${trackId}: Resuming AudioContext on play.`);
        audioContext.resume().then(() => {
            console.log(`Track ${trackId}: AudioContext resumed. Proceeding with toggle.`);
             _performTogglePlayPause(trackId);
        }).catch(err => {
             console.error(`Track ${trackId}: Failed to resume AudioContext:`, err);
             alert("Could not start audio playback. Please interact with the page (click) and try again.");
        });
    } else {
        _performTogglePlayPause(trackId);
    }
}

function _performTogglePlayPause(trackId) {
     const track = tracks[trackId];

    if (track.isPlaying) {
        if (track.sourceNode) {
             console.log(`Track ${trackId}: Stopping playback.`);
            try { track.sourceNode.stop(); } catch (e) {
                 console.warn(`Track ${trackId}: Error on sourceNode.stop() (may be benign):`, e);
            }
            // Explicitly disconnect to be safe, though stop usually handles it
            track.sourceNode.disconnect();
            track.sourceNode.onended = null; // Remove listener
            track.sourceNode = null;
        } else {
             console.warn(`Track ${trackId}: Tried to stop, but sourceNode was already null.`);
        }
        track.isPlaying = false;
        track.playPauseButton.textContent = 'Play';
        console.log(`Track ${trackId} stopped.`);

    } else {
         if (track.sourceNode) {
             console.warn(`Track ${trackId}: Tried to play, but sourceNode already exists. Stopping previous first.`);
             try { track.sourceNode.stop(); } catch(e){}
             track.sourceNode.disconnect();
             track.sourceNode = null;
         }

        console.log(`Track ${trackId}: Creating new source node.`);
        track.sourceNode = audioContext.createBufferSource();
        track.sourceNode.buffer = track.buffer;
        track.sourceNode.playbackRate.value = track.playbackRate;

        // *** Apply Loop Settings ***
        if (track.isLooping) {
            track.sourceNode.loop = true;
            track.sourceNode.loopStart = track.startTime;
            track.sourceNode.loopEnd = track.endTime;
            console.log(`Track ${trackId}: Looping enabled. Start: ${track.startTime.toFixed(2)}, End: ${track.endTime.toFixed(2)}`);
        } else {
            track.sourceNode.loop = false;
             console.log(`Track ${trackId}: Looping disabled.`);
        }

        track.sourceNode.connect(track.gainNode);

        const offset = track.startTime; // Start playing from the start marker
        // Calculate duration *only* if not looping
        const duration = track.isLooping ? undefined : track.endTime - track.startTime;

        console.log(`Track ${trackId}: Starting playback. Offset: ${offset.toFixed(2)}, Duration: ${duration ? duration.toFixed(2) : 'looping'}`);
        // Use try/catch around start for potential errors with invalid times
        try {
             track.sourceNode.start(0, offset, duration); // Start immediately (0)
        } catch (e) {
             console.error(`Track ${trackId}: Error calling sourceNode.start: `, e);
             alert(`Track ${trackId}: Error starting playback. Check start/end times.`);
             track.sourceNode = null; // Clean up failed node
             return; // Don't proceed
        }

        track.isPlaying = true;
        track.playPauseButton.textContent = 'Stop';
        console.log(`Track ${trackId} playing.`);

        const currentSourceNode = track.sourceNode;
        currentSourceNode.onended = () => {
             // Only process 'ended' if it's the current node and wasn't manually stopped
             if (track.sourceNode === currentSourceNode && track.isPlaying) {
                 // If not looping, it finished naturally
                 if (!track.isLooping) {
                    track.isPlaying = false;
                    track.playPauseButton.textContent = 'Play';
                    track.sourceNode = null;
                    console.log(`Track ${trackId} finished playing naturally (not looping).`);
                    checkMasterPlayEnable();
                 } else {
                     // If looping, 'onended' shouldn't fire unless stop() was called.
                     // This case might indicate an issue or manual stop.
                      console.log(`Track ${trackId}: onended called while looping (likely manual stop).`);
                      // State should already be handled by the stop logic.
                 }

             } else if (track.sourceNode === currentSourceNode && !track.isPlaying) {
                 // onended called after manual stop, node is already nullified by stop logic
                 console.log(`Track ${trackId}: onended called after manual stop.`);
                 track.sourceNode = null; // Ensure cleanup just in case
             } else {
                 console.log(`Track ${trackId}: onended called for an old/stopped source, ignoring.`);
             }
         };
    }
    checkMasterPlayEnable();
}


// --- Volume Control ---
function handleVolumeChange(event, trackId) {
    const track = tracks[trackId];
    if (track && track.gainNode && audioContext) {
         track.gainNode.gain.linearRampToValueAtTime(
            parseFloat(event.target.value),
            audioContext.currentTime + 0.05
        );
    }
}

// --- Playback Rate Control ---
function handlePlaybackRateChange(event, trackId) {
    const track = tracks[trackId];
    if (!track || !audioContext) return;

    const newRate = parseFloat(event.target.value);
    track.playbackRate = newRate;

    if (track.rateValueDisplay) {
        track.rateValueDisplay.textContent = newRate.toFixed(2);
    }

    if (track.isPlaying && track.sourceNode) {
         console.log(`Track ${trackId}: Updating playbackRate to ${newRate}`);
         track.sourceNode.playbackRate.linearRampToValueAtTime(newRate, audioContext.currentTime + 0.05);
         // Note: Changing rate while looping might affect perceived loop points slightly
         // For precise loops with rate changes, more complex handling (e.g., manual scheduling) might be needed.
    }
}

// --- Loop Toggle Control ---
function handleLoopToggleChange(event, trackId) {
    const track = tracks[trackId];
    if (!track) return;

    track.isLooping = event.target.checked;
    console.log(`Track ${trackId}: Loop toggled to ${track.isLooping}`);

    // If currently playing, stop and restart with the new loop setting
    if (track.isPlaying) {
         console.log(`Track ${trackId}: Restarting playback due to loop change.`);
        stopAndRestartPlayback(trackId);
    }
}


// --- Master Play/Pause Logic ---
function toggleMasterPlayPause() {
    if (!audioContext) {
        console.warn("Master Play/Pause: AudioContext not ready.");
        return;
    }

    if (audioContext.state === 'suspended') {
        console.log("Master Play/Pause: Resuming AudioContext...");
        audioContext.resume().then(() => {
             console.log("Master Play/Pause: AudioContext resumed. Proceeding.");
            _performToggleMasterPlayPause();
        }).catch(err => {
             console.error("Master Play/Pause: Failed to resume AudioContext:", err);
             alert("Could not start/stop audio. Please interact with the page (click) and try again.");
        });
    } else {
        _performToggleMasterPlayPause();
    }
}

function _performToggleMasterPlayPause() {
    const anyLoaded = Object.values(tracks).some(t => t.isLoaded);
    if (!anyLoaded) {
        console.log("Master Play/Pause: No tracks loaded.");
        return;
    }

    const currentlyPlaying = Object.values(tracks).some(t => t.isLoaded && t.isPlaying);
    const targetStateShouldBePlaying = !currentlyPlaying;

    console.log(`Master Play/Pause: Target state is ${targetStateShouldBePlaying ? 'PLAY' : 'STOP'}`);

    let actionTaken = false;
    for (const trackId in tracks) {
        const track = tracks[trackId];
        if (track.isLoaded) {
            if (targetStateShouldBePlaying && !track.isPlaying) {
                 console.log(`Master Play/Pause: Starting Track ${trackId}`);
                _performTogglePlayPause(trackId);
                actionTaken = true;
            } else if (!targetStateShouldBePlaying && track.isPlaying) {
                 console.log(`Master Play/Pause: Stopping Track ${trackId}`);
                _performTogglePlayPause(trackId);
                actionTaken = true;
            }
        }
    }

     if (anyLoaded) {
        const nowPlaying = Object.values(tracks).some(t => t.isLoaded && t.isPlaying);
        masterPlayPauseButton.textContent = nowPlaying ? 'Stop All' : 'Play All';
     }
}


// --- Utility Functions ---
function checkMasterPlayEnable() {
    const anyLoaded = Object.values(tracks).some(track => track.isLoaded);
    masterPlayPauseButton.disabled = !anyLoaded;

    const anyPlaying = Object.values(tracks).some(track => track.isLoaded && track.isPlaying);
    if (anyLoaded) {
        masterPlayPauseButton.textContent = anyPlaying ? 'Stop All' : 'Play All';
    } else {
         masterPlayPauseButton.textContent = 'Play/Pause All';
         masterPlayPauseButton.disabled = true;
    }
}

// --- Additions for Robustness ---
if (typeof audioContext !== 'undefined' && audioContext?.addEventListener) {
    audioContext.addEventListener('statechange', () => {
        console.log('AudioContext state changed to:', audioContext.state);
        const isRunning = audioContext.state === 'running';
         Object.values(tracks).forEach(track => {
             // Disable play if context not running OR track not loaded
             if (track.playPauseButton) track.playPauseButton.disabled = !isRunning || !track.isLoaded;
             // Disable interaction if context not running
              if (track.canvas) track.canvas.style.pointerEvents = isRunning ? 'auto' : 'none';
         });
         // Disable master play if context not running OR nothing loaded
         if(masterPlayPauseButton) masterPlayPauseButton.disabled = !isRunning || !Object.values(tracks).some(t => t.isLoaded);

        if (!isRunning) {
             console.warn("AudioContext is not running. Playback/Interaction stopped/unavailable.");
        } else {
             console.log("AudioContext is running.");
             // Re-check button states based on loaded/playing status
             checkMasterPlayEnable();
             Object.values(tracks).forEach(track => {
                  if (track.isLoaded && track.playPauseButton) {
                      track.playPauseButton.disabled = false; // Re-enable if loaded
                  }
             });
        }
    });
}