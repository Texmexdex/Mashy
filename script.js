// --- Global Variables ---
let audioContext;
const tracks = {};
let masterGainNode;
let isWorkletLoaded = false; // Flag to track if the AudioWorklet module is loaded
const WORKLET_URL = 'https://unpkg.com/@soundtouchjs/audio-worklet/dist/soundtouch-worklet.js';
const WORKLET_NAME = 'soundtouch-processor';
const MARKER_CLICK_TOLERANCE = 5;

// --- DOM Element References ---
const masterPlayPauseButton = document.getElementById('master-play-pause');
const masterVolumeSlider = document.getElementById('master-volume');

// --- Initialization ---
// No audio context created initially, wait for user interaction
window.addEventListener('load', () => {
    console.log("Page loaded. Setting up tracks (without AudioContext initially).");
    setupTrack(1);
    setupTrack(2);
});

// --- Function to Initialize AudioContext and Load Worklet ---
async function initializeAudioAndWorklet() {
    if (audioContext && isWorkletLoaded) {
        // Already initialized
        if (audioContext.state === 'suspended') {
            await audioContext.resume(); // Resume if suspended
        }
        return true;
    }
    if (audioContext && !isWorkletLoaded) {
        console.warn("AudioContext exists but worklet not loaded. Attempting load again.");
        // Proceed to load worklet
    }

    // First time or re-attempt after context creation failure
    if (!audioContext) {
        try {
            console.log("Creating AudioContext...");
            window.AudioContext = window.AudioContext || window.webkitAudioContext;
            audioContext = new AudioContext();
            console.log("AudioContext created. State:", audioContext.state);

            masterGainNode = audioContext.createGain();
            masterGainNode.gain.value = masterVolumeSlider.value;
            masterGainNode.connect(audioContext.destination);
            console.log("Master Gain Node created.");

            // Add state change listener for robustness
            audioContext.addEventListener('statechange', handleAudioContextStateChange);

        } catch (e) {
            alert('Web Audio API is not supported or could not be initialized.');
            console.error("Error initializing AudioContext:", e);
            audioContext = null; // Ensure it's null on failure
            return false;
        }
    }

    // Ensure context is running before adding module
    if (audioContext.state === 'suspended') {
        console.log("AudioContext suspended, resuming before loading worklet...");
        try {
            await audioContext.resume();
             console.log("AudioContext resumed.");
        } catch (err) {
            console.error("Failed to resume AudioContext:", err);
            alert("Could not resume AudioContext. Please interact with the page again.");
            return false;
        }
    }

    // Load the AudioWorklet module
    if (!isWorkletLoaded) {
        console.log(`Attempting to load AudioWorklet module from: ${WORKLET_URL}`);
        try {
            await audioContext.audioWorklet.addModule(WORKLET_URL);
            console.log("AudioWorklet module loaded successfully!");
            isWorkletLoaded = true;
            return true;
        } catch (e) {
            console.error("Error loading AudioWorklet module:", e);
            alert(`Failed to load audio processing module. Check console for details. Ensure you are running from a local server (http://localhost:...) not a file:// URL.`);
            // Don't nullify audioContext here, maybe user can try again
            isWorkletLoaded = false;
            return false;
        }
    }
    return true; // Should already be loaded if we reached here
}


// --- Track Setup Function ---
function setupTrack(trackId) {
    // Get DOM elements even before AudioContext exists
    const trackElement = document.getElementById(`track${trackId}`);
    if (!trackElement) return;

    const fileInput = document.getElementById(`file-input-${trackId}`);
    const fileNameDisplay = document.getElementById(`file-name-${trackId}`);
    const waveformCanvas = document.getElementById(`waveform-${trackId}`);
    const playPauseButton = document.getElementById(`play-pause-${trackId}`);
    const volumeSlider = document.getElementById(`volume-${trackId}`);
    const loopToggle = document.getElementById(`loop-${trackId}`);
    const canvasCtx = waveformCanvas.getContext('2d');
    const tempoSlider = document.getElementById(`tempo-${trackId}`);
    const tempoValueDisplay = document.getElementById(`tempo-value-${trackId}`);
    const pitchSlider = document.getElementById(`pitch-${trackId}`);
    const pitchValueDisplay = document.getElementById(`pitch-value-${trackId}`);

    tracks[trackId] = {
        id: trackId,
        buffer: null,
        sourceNode: null, // Plays the original audio into the worklet
        soundtouchNode: null, // The AudioWorkletNode instance
        gainNode: null, // Will be created *with* AudioContext
        tempo: parseFloat(tempoSlider.value),
        pitchSemitones: parseFloat(pitchSlider.value),
        isPlaying: false,
        isLoaded: false,
        isLooping: loopToggle.checked,
        playbackStartTime: 0, // audioContext.currentTime when playback started
        playbackOffset: 0, // Offset within the source buffer when starting/resuming
        startTime: 0, // Loop/segment start time
        endTime: 0, // Loop/segment end time
        draggingMarker: null,
        isDragging: false,
        playPauseButton,
        volumeSlider,
        loopToggle,
        canvas: waveformCanvas,
        canvasCtx,
        fileNameDisplay,
        tempoSlider,
        tempoValueDisplay,
        pitchSlider,
        pitchValueDisplay
    };

    // Add listeners (these work even without AudioContext)
    fileInput.addEventListener('change', (event) => handleFileLoad(event, trackId));
    playPauseButton.addEventListener('click', () => togglePlayPause(trackId));
    volumeSlider.addEventListener('input', (event) => handleVolumeChange(event, trackId));
    loopToggle.addEventListener('change', (event) => handleLoopToggleChange(event, trackId));
    tempoSlider.addEventListener('input', (event) => handleTempoChange(event, trackId));
    pitchSlider.addEventListener('input', (event) => handlePitchChange(event, trackId));
    waveformCanvas.addEventListener('mousedown', (event) => handleCanvasMouseDown(event, trackId));
    waveformCanvas.addEventListener('mousemove', (event) => handleCanvasMouseMove(event, trackId));
    window.addEventListener('mouseup', (event) => handleCanvasMouseUp(event, trackId));
    waveformCanvas.addEventListener('mouseleave', (event) => handleCanvasMouseLeave(event, trackId));
}

// --- Master Control Event Listeners ---
masterVolumeSlider.addEventListener('input', (event) => {
    if (masterGainNode && audioContext) {
        masterGainNode.gain.linearRampToValueAtTime(parseFloat(event.target.value), audioContext.currentTime + 0.05);
    }
});
masterPlayPauseButton.addEventListener('click', toggleMasterPlayPause);

// --- Audio Loading ---
async function handleFileLoad(event, trackId) {
    // Ensure AudioContext exists before decoding - needs interaction first
    const ready = await initializeAudioAndWorklet();
    if (!ready || !audioContext) {
        alert("Audio system not ready. Please try loading the file again after interacting with the page (e.g., clicking Play).");
        // Reset file input?
        event.target.value = null; // Clear the selected file
        return;
    }

    const file = event.target.files[0];
    if (!file) return;

    const track = tracks[trackId];
    resetTrackState(trackId); // Reset before loading

    track.fileNameDisplay.textContent = `Loading: ${file.name}...`;
    track.playPauseButton.disabled = true;

    try {
        const arrayBuffer = await file.arrayBuffer();
        // Use the now guaranteed existing audioContext
        audioContext.decodeAudioData(arrayBuffer, (decodedBuffer) => {
            track.buffer = decodedBuffer;
            track.isLoaded = true;
            track.playPauseButton.disabled = false;
            track.fileNameDisplay.textContent = file.name;
            track.startTime = 0;
            track.endTime = decodedBuffer.duration;
            track.playbackOffset = 0; // Reset offset on new load

            // Create track-specific gain node now that context exists
            if (!track.gainNode) {
                 track.gainNode = audioContext.createGain();
                 track.gainNode.gain.value = track.volumeSlider.value;
                 track.gainNode.connect(masterGainNode); // Connect to master
            }

            track.tempoSlider.disabled = false;
            track.pitchSlider.disabled = false;
            track.loopToggle.disabled = false;

            drawWaveform(trackId);
            checkMasterPlayEnable();
            track.canvas.classList.add('interactive');
        }, (error) => {
            console.error(`Error decoding audio data for track ${trackId}:`, error);
            alert(`Error decoding file "${file.name}". Check console.`);
            resetTrackState(trackId);
            track.fileNameDisplay.textContent = 'Load failed';
        });
    } catch (error) {
        console.error(`Error reading file for track ${trackId}:`, error);
        alert(`Error reading file "${file.name}".`);
        resetTrackState(trackId);
        track.fileNameDisplay.textContent = 'Load failed';
    }
}

// --- Reset Track State ---
function resetTrackState(trackId) {
    const track = tracks[trackId];
    if (!track) return;

    if (track.isPlaying) {
        _performTogglePlayPause(trackId); // Attempt to stop
    }
    // Ensure nodes are cleaned up
    if (track.sourceNode) {
        try { track.sourceNode.stop(); } catch(e) {}
        track.sourceNode.disconnect();
        track.sourceNode.onended = null;
        track.sourceNode = null;
    }
    if (track.soundtouchNode) {
        track.soundtouchNode.disconnect();
        // Cannot remove parameters once created, but node will be garbage collected
        track.soundtouchNode = null;
    }
     // Don't disconnect track.gainNode from masterGainNode here, just reset value
     if (track.gainNode) track.gainNode.gain.value = track.volumeSlider.value;


    track.isPlaying = false;
    track.isLoaded = false;
    track.buffer = null;
    track.startTime = 0;
    track.endTime = 0;
    track.playbackOffset = 0;
    track.tempo = 1.0;
    track.pitchSemitones = 0.0;
    track.draggingMarker = null;
    track.isDragging = false;

    if (track.playPauseButton) {
        track.playPauseButton.disabled = true;
        track.playPauseButton.textContent = 'Play';
    }
    if (track.fileNameDisplay) track.fileNameDisplay.textContent = 'No file loaded';
    if (track.canvasCtx && track.canvas) {
        track.canvasCtx.fillStyle = '#282c34';
        track.canvasCtx.fillRect(0, 0, track.canvas.width, track.canvas.height);
        track.canvas.classList.remove('interactive');
    }
    if (track.tempoSlider) {
        track.tempoSlider.value = 1.0;
        track.tempoSlider.disabled = true;
    }
    if (track.tempoValueDisplay) track.tempoValueDisplay.textContent = '1.00';
    if (track.pitchSlider) {
        track.pitchSlider.value = 0;
        track.pitchSlider.disabled = true;
    }
    if (track.pitchValueDisplay) track.pitchValueDisplay.textContent = '0';
    if (track.loopToggle) {
        track.loopToggle.checked = false;
        track.loopToggle.disabled = true;
    }
    track.isLooping = false;
}

// --- Waveform Drawing (Unchanged) ---
function drawWaveform(trackId) {
    const track = tracks[trackId];
    if (!track?.canvasCtx || !track?.canvas) return;
    const ctx = track.canvasCtx;
    const canvas = track.canvas;
    const width = canvas.width;
    const height = canvas.height;
    ctx.fillStyle = '#282c34';
    ctx.fillRect(0, 0, width, height);
    if (!track.buffer || !track.isLoaded) return;
    const buffer = track.buffer;
    const duration = buffer.duration;
    if (buffer.numberOfChannels > 0 && buffer.length > 0 && duration > 0) {
        const data = buffer.getChannelData(0);
        const step = Math.ceil(data.length / width);
        const amp = height / 2;
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#61dafb';
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
            if (yMax <= yMin + 1) { ctx.moveTo(x + 0.5, yMin); ctx.lineTo(x + 0.5, yMin + 1); }
            else { ctx.moveTo(x + 0.5, yMin); ctx.lineTo(x + 0.5, yMax); }
            x++;
            if (x >= width) break;
        }
        ctx.stroke();
        const startX = (track.startTime / duration) * width;
        ctx.strokeStyle = 'rgba(0, 255, 0, 0.8)'; ctx.lineWidth = 2; ctx.beginPath();
        ctx.moveTo(startX, 0); ctx.lineTo(startX, height); ctx.stroke();
        const endX = (track.endTime / duration) * width;
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)'; ctx.lineWidth = 2; ctx.beginPath();
        ctx.moveTo(endX, 0); ctx.lineTo(endX, height); ctx.stroke();
    } else {
        ctx.fillStyle = '#aaaaaa'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('No Audio Data', width / 2, height / 2);
    }
}

// --- Canvas Interaction Helpers (Unchanged) ---
function getMousePos(canvas, evt) { /* ... */ }
function getTimeFromX(x, canvasWidth, duration) { /* ... */ }
function getMarkerAtX(x, track) { /* ... */ }
// Implementation from previous version...
function getMousePos(canvas, evt) { const rect = canvas.getBoundingClientRect(); return { x: evt.clientX - rect.left, y: evt.clientY - rect.top }; }
function getTimeFromX(x, canvasWidth, duration) { const clampedX = Math.max(0, Math.min(canvasWidth, x)); return (clampedX / canvasWidth) * duration; }
function getMarkerAtX(x, track) { if (!track.isLoaded || !track.buffer) return null; const width = track.canvas.width; const duration = track.buffer.duration; if (duration <= 0) return null; const startX = (track.startTime / duration) * width; const endX = (track.endTime / duration) * width; if (Math.abs(x - startX) <= MARKER_CLICK_TOLERANCE) return 'start'; if (Math.abs(x - endX) <= MARKER_CLICK_TOLERANCE) return 'end'; return null; }


// --- Canvas Event Handlers ---
function handleCanvasMouseDown(event, trackId) { /* ... */ }
function handleCanvasMouseMove(event, trackId) { /* ... */ }
function handleCanvasMouseUp(event, trackId) { /* ... */ }
function handleCanvasMouseLeave(event, trackId) { /* ... */ }
// Implementation from previous version...
function handleCanvasMouseDown(event, trackId) { const track = tracks[trackId]; if (!track.isLoaded || !track.buffer || track.buffer.duration <= 0) return; const pos = getMousePos(track.canvas, event); const marker = getMarkerAtX(pos.x, track); if (marker) { track.draggingMarker = marker; track.isDragging = true; track.canvas.style.cursor = 'grabbing'; event.preventDefault(); } }
function handleCanvasMouseMove(event, trackId) { const track = tracks[trackId]; if (!track.isLoaded || !track.buffer || track.buffer.duration <= 0) return; const pos = getMousePos(track.canvas, event); const duration = track.buffer.duration; if (track.isDragging && track.draggingMarker) { let newTime = getTimeFromX(pos.x, track.canvas.width, duration); let needsRestart = false; if (track.draggingMarker === 'start') { newTime = Math.min(newTime, track.endTime - 0.001); track.startTime = Math.max(0, newTime); if (track.isPlaying && track.startTime > track.playbackOffset) { track.playbackOffset = track.startTime; needsRestart = true; } } else { newTime = Math.max(newTime, track.startTime + 0.001); track.endTime = Math.min(duration, newTime); if (track.isPlaying && track.endTime < track.playbackOffset) { track.playbackOffset = track.startTime; needsRestart = true; } } drawWaveform(trackId); if (needsRestart) { console.log("Marker moved past playhead, restarting source node."); stopAndRestartPlayback(trackId); } } else if (track.isLoaded) { const marker = getMarkerAtX(pos.x, track); track.canvas.style.cursor = marker ? 'ew-resize' : 'default'; } }
function handleCanvasMouseUp(event, trackId) { const track = tracks[trackId]; if (track && track.isDragging) { track.isDragging = false; track.draggingMarker = null; // Restart playback if looping and markers changed
        if (track.isPlaying && track.isLooping) { stopAndRestartPlayback(trackId); } } Object.values(tracks).forEach(t => { if (t?.canvas && !t.isDragging) { const pos = getMousePos(t.canvas, event); const marker = getMarkerAtX(pos.x, t); t.canvas.style.cursor = marker ? 'ew-resize' : 'default'; } }); }
function handleCanvasMouseLeave(event, trackId) { const track = tracks[trackId]; if (track && !track.isDragging) { track.canvas.style.cursor = 'default'; } }


// --- Playback Control ---
async function togglePlayPause(trackId) {
    const track = tracks[trackId];
    if (!track?.isLoaded) return;

    // Initialize audio context and load worklet if not done yet
    const ready = await initializeAudioAndWorklet();
    if (!ready || !audioContext) {
         alert("Audio system could not be initialized. Please try again.");
         return; // Exit if initialization failed
    }

     // Ensure track gain node exists (might be first play after load)
     if (!track.gainNode) {
        track.gainNode = audioContext.createGain();
        track.gainNode.gain.value = track.volumeSlider.value;
        track.gainNode.connect(masterGainNode);
     }


    _performTogglePlayPause(trackId);
}

function _performTogglePlayPause(trackId) {
    const track = tracks[trackId];
    if (!track.isLoaded || !audioContext) return; // Should have context by now

    if (track.isPlaying) {
        // --- STOP ---
        console.log(`Track ${trackId}: Stopping...`);
        if (track.sourceNode) {
            try {
                track.sourceNode.stop(); // Stop immediately
                track.sourceNode.disconnect(); // Disconnect from worklet node
                track.sourceNode.onended = null;
            } catch (e) { console.warn("Error stopping source node:", e.message); }
            track.sourceNode = null;
        }
        // Worklet node and gain node persist, just the source stops feeding them

        // Store current playback position offset
        track.playbackOffset += audioContext.currentTime - track.playbackStartTime;
         // Clamp offset within bounds
         track.playbackOffset = Math.max(track.startTime, Math.min(track.endTime, track.playbackOffset));
         if (track.playbackOffset >= track.endTime) track.playbackOffset = track.startTime; // Loop back if stopped exactly at end


        track.isPlaying = false;
        track.playPauseButton.textContent = 'Play';

    } else {
        // --- START ---
        console.log(`Track ${trackId}: Starting...`);
        if (!track.buffer) { console.error("Track buffer not loaded"); return; }
        if (track.startTime >= track.endTime) { console.warn("Start time is not before end time."); return; }
         // Ensure playbackOffset is valid before starting
         if (track.playbackOffset < track.startTime || track.playbackOffset >= track.endTime) {
             track.playbackOffset = track.startTime; // Reset to start if invalid or past end
         }

        // 1. Create the AudioWorkletNode if it doesn't exist for this track
        if (!track.soundtouchNode) {
             try {
                console.log(`Creating AudioWorkletNode ('${WORKLET_NAME}') for track ${trackId}`);
                track.soundtouchNode = new AudioWorkletNode(audioContext, WORKLET_NAME);
                // Set initial parameters from sliders/state
                handleTempoChange({ target: track.tempoSlider }, trackId); // Use handler to set node param
                handlePitchChange({ target: track.pitchSlider }, trackId); // Use handler to set node param
                 // Connect worklet node to track's gain node
                 track.soundtouchNode.connect(track.gainNode);
             } catch (e) {
                 console.error(`Failed to create AudioWorkletNode '${WORKLET_NAME}':`, e);
                 alert(`Error: Could not create audio processing node. Worklet '${WORKLET_NAME}' not registered?`);
                 return;
             }
        }

        // 2. Create and configure the AudioBufferSourceNode
        track.sourceNode = audioContext.createBufferSource();
        track.sourceNode.buffer = track.buffer;
        // Playback rate is ALWAYS 1.0 - tempo handled by worklet
        track.sourceNode.playbackRate.value = 1.0;

        // 3. Connect Source -> Worklet
        track.sourceNode.connect(track.soundtouchNode);

        // 4. Set Looping on the Source Node
        track.sourceNode.loop = track.isLooping;
        if (track.isLooping) {
            track.sourceNode.loopStart = track.startTime;
            track.sourceNode.loopEnd = track.endTime;
            // Basic validation for loop points
            if (track.sourceNode.loopEnd <= track.sourceNode.loopStart) {
                console.warn(`Track ${trackId}: Loop end (${track.sourceNode.loopEnd.toFixed(3)}) is not after loop start (${track.sourceNode.loopStart.toFixed(3)}). Disabling loop.`);
                track.sourceNode.loop = false;
                 // track.isLooping = false; // Sync internal state? Or let checkbox drive?
                 // track.loopToggle.checked = false;
            }
        }

        // 5. Start Playback
        track.playbackStartTime = audioContext.currentTime; // Record start time
        const offsetToUse = track.playbackOffset; // Use stored offset

        try {
            // Start playing from the calculated offset.
            // If looping, duration is ignored. If not looping, calculate remaining duration.
            if (track.isLooping) {
                 console.log(`Track ${trackId}: Starting looped playback from offset ${offsetToUse.toFixed(3)}`);
                 track.sourceNode.start(0, offsetToUse);
            } else {
                const remainingDuration = track.endTime - offsetToUse;
                 if (remainingDuration > 0) {
                    console.log(`Track ${trackId}: Starting single playback from offset ${offsetToUse.toFixed(3)} for duration ${remainingDuration.toFixed(3)}`);
                    track.sourceNode.start(0, offsetToUse, remainingDuration);
                 } else {
                     console.log(`Track ${trackId}: Attempted to start at or past end marker. Resetting offset.`);
                      track.playbackOffset = track.startTime; // Reset to start
                      track.sourceNode.start(0, track.playbackOffset, track.endTime - track.playbackOffset); // Start from beginning of segment
                 }
            }
        } catch (e) {
            console.error(`Track ${trackId}: Error starting source node:`, e);
            track.sourceNode.disconnect();
            track.sourceNode = null;
            if (track.soundtouchNode) { // Clean up worklet connection if start fails
                 track.soundtouchNode.disconnect();
                 // track.soundtouchNode = null; // Don't nullify, might reuse
            }
            return;
        }

        track.isPlaying = true;
        track.playPauseButton.textContent = 'Stop';

        // Handle track ending naturally (only relevant for non-looping)
        const currentSourceNode = track.sourceNode; // Capture current node instance
        currentSourceNode.onended = () => {
             // Check if this ended naturally and wasn't manually stopped
             if (track.sourceNode === currentSourceNode && track.isPlaying && !track.isLooping) {
                 console.log(`Track ${trackId}: Playback ended naturally.`);
                 _performTogglePlayPause(trackId); // Call stop logic
                 // Reset offset to start for next play
                 track.playbackOffset = track.startTime;
                 checkMasterPlayEnable(); // Update master button after natural end
             } else {
                 // console.log(`Track ${trackId}: onended called for stopped or looping node.`);
             }
        };
    }
    checkMasterPlayEnable(); // Update master button state
}


// --- Stop and Restart Helper (Used for loop changes, marker drags) ---
function stopAndRestartPlayback(trackId) {
    const track = tracks[trackId];
    if (track && track.isPlaying) {
        console.log(`Track ${trackId}: Stopping and restarting playback.`);
        _performTogglePlayPause(trackId); // Stop
        // Small delay might still be good practice? Or start immediately?
        // Let's try immediately as we stored the offset
         setTimeout(() => {
             if (track.isLoaded) { // Check still loaded
                 _performTogglePlayPause(trackId); // Start again
             }
         }, 10); // Small delay
    }
}

// --- Volume Control ---
function handleVolumeChange(event, trackId) {
    const track = tracks[trackId];
    // Ensure gainNode exists (might not if context not initialized)
    if (track?.gainNode && audioContext) {
        track.gainNode.gain.linearRampToValueAtTime(parseFloat(event.target.value), audioContext.currentTime + 0.05);
    } else if (track) {
        // Store value for when gainNode is created
         track.volumeSlider.value = event.target.value;
    }
}

// --- Tempo Handler ---
function handleTempoChange(event, trackId) {
    const track = tracks[trackId];
    if (!track) return;
    const newTempo = parseFloat(event.target.value);
    track.tempo = newTempo; // Update stored state
    if (track.tempoValueDisplay) {
        track.tempoValueDisplay.textContent = newTempo.toFixed(2);
    }
    // Update AudioWorkletNode parameter if it exists
    if (track.soundtouchNode && track.soundtouchNode.parameters.get('tempo')) {
        // Use setTargetAtTime for potentially smoother changes? Or direct setValue?
        // Direct value is simpler for now.
        track.soundtouchNode.parameters.get('tempo').value = newTempo;
         // console.log(`Track ${trackId}: Set worklet tempo to ${newTempo}`);
    } else {
        // console.log(`Track ${trackId}: Stored tempo ${newTempo}, node not ready.`);
    }
}

// --- Pitch Handler ---
function handlePitchChange(event, trackId) {
    const track = tracks[trackId];
    if (!track) return;
    const newPitch = parseFloat(event.target.value);
    track.pitchSemitones = newPitch; // Update stored state
    if (track.pitchValueDisplay) {
        track.pitchValueDisplay.textContent = newPitch >= 0 ? `+${newPitch.toFixed(1)}` : newPitch.toFixed(1);
    }
    // Update AudioWorkletNode parameter if it exists
    if (track.soundtouchNode && track.soundtouchNode.parameters.get('pitchSemitones')) {
        track.soundtouchNode.parameters.get('pitchSemitones').value = newPitch;
         // console.log(`Track ${trackId}: Set worklet pitchSemitones to ${newPitch}`);
    } else {
         // console.log(`Track ${trackId}: Stored pitch ${newPitch}, node not ready.`);
    }
}

// --- Loop Toggle Control ---
function handleLoopToggleChange(event, trackId) {
    const track = tracks[trackId];
    if (!track || !track.isLoaded) return;
    track.isLooping = event.target.checked;
    console.log(`Track ${trackId}: Loop toggled to ${track.isLooping}`);
    // If playing, need to stop the current source and start a new one
    // with the updated loop property. The worklet node itself doesn't change.
    if (track.isPlaying) {
        stopAndRestartPlayback(trackId);
    }
}

// --- Master Play/Pause Logic ---
async function toggleMasterPlayPause() {
    // Ensure context/worklet are ready first
    const ready = await initializeAudioAndWorklet();
    if (!ready || !audioContext) {
        alert("Audio system not ready. Cannot toggle master play.");
        return;
    }
    _performToggleMasterPlayPause();
}
function _performToggleMasterPlayPause() {
    const anyLoaded = Object.values(tracks).some(t => t?.isLoaded);
    if (!anyLoaded) return;
    const currentlyPlaying = Object.values(tracks).some(t => t?.isLoaded && t.isPlaying);
    const targetStateShouldBePlaying = !currentlyPlaying;
    for (const trackId in tracks) {
        const track = tracks[trackId];
        if (track?.isLoaded) {
            // Ensure gain node exists before trying to play
             if (targetStateShouldBePlaying && !track.gainNode) {
                track.gainNode = audioContext.createGain();
                track.gainNode.gain.value = track.volumeSlider.value;
                track.gainNode.connect(masterGainNode);
             }

            if (targetStateShouldBePlaying && !track.isPlaying) {
                _performTogglePlayPause(trackId);
            } else if (!targetStateShouldBePlaying && track.isPlaying) {
                _performTogglePlayPause(trackId);
            }
        }
    }
    // Update button text after attempting changes
    const nowPlaying = Object.values(tracks).some(t => t?.isLoaded && t.isPlaying);
    masterPlayPauseButton.textContent = nowPlaying ? 'Stop All' : 'Play All';
    masterPlayPauseButton.disabled = !anyLoaded;
}

// --- Utility Functions ---
function checkMasterPlayEnable() {
    const anyLoaded = Object.values(tracks).some(track => track?.isLoaded);
    const contextReady = !!audioContext; // Check if context exists

    masterPlayPauseButton.disabled = !anyLoaded || !contextReady || !isWorkletLoaded;

    if (anyLoaded && contextReady) {
        const anyPlaying = Object.values(tracks).some(track => track?.isLoaded && track.isPlaying);
        masterPlayPauseButton.textContent = anyPlaying ? 'Stop All' : 'Play All';
    } else {
        masterPlayPauseButton.textContent = 'Play/Pause All';
    }
}

// --- AudioContext State Change Handler ---
function handleAudioContextStateChange() {
    if (!audioContext) return;
    console.log('AudioContext state changed to:', audioContext.state);
    const isRunning = audioContext.state === 'running';

    Object.values(tracks).forEach(track => {
        if (!track) return;
        const controlsShouldBeDisabled = !isRunning || !track.isLoaded || !isWorkletLoaded;
        if (track.playPauseButton) track.playPauseButton.disabled = controlsShouldBeDisabled;
        if (track.canvas) track.canvas.style.pointerEvents = isRunning ? 'auto' : 'none';
        if (track.tempoSlider) track.tempoSlider.disabled = controlsShouldBeDisabled;
        if (track.pitchSlider) track.pitchSlider.disabled = controlsShouldBeDisabled;
        if (track.loopToggle) track.loopToggle.disabled = controlsShouldBeDisabled;

        // If context stopped running while playing, force track state to stopped
         if (!isRunning && track.isPlaying) {
             console.warn(`AudioContext stopped while track ${track.id} was playing. Forcing stop.`);
              _performTogglePlayPause(track.id); // Force stop logic
         }
    });

    checkMasterPlayEnable(); // Update master button based on new state

    if (!isRunning) {
        console.warn("AudioContext is not running.");
    }
}