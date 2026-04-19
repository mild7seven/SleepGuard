let audioContext;
let analyser;
let microphone;
let filter;
let mediaRecorder;
let audioChunks = [];
let isMonitoring = false;
let isRecording = false;
let silenceTimer;
let wakeLock = null;

// Konfigurasi Awal
let THRESHOLD = 25; 
const SILENCE_DURATION = 3000; 

// Elemen DOM
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const canvas = document.getElementById('waveform');
const canvasCtx = canvas.getContext('2d');
const logList = document.getElementById('logList');
const thresholdSlider = document.getElementById('thresholdSlider');
const thresholdVal = document.getElementById('thresholdVal');
const wakeLockStatus = document.getElementById('wakeLockStatus');

// Update Threshold dari UI
thresholdSlider.addEventListener('input', (e) => {
    THRESHOLD = parseInt(e.target.value);
    thresholdVal.innerText = THRESHOLD;
});

// Manajemen Wake Lock API
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLockStatus.innerText = "Wake Lock: Aktif (Layar terjaga)";
            wakeLockStatus.classList.add('active');
            
            // Re-acquire wake lock jika halaman di-minimize lalu dibuka lagi
            document.addEventListener('visibilitychange', async () => {
                if (wakeLock !== null && document.visibilityState === 'visible') {
                    wakeLock = await navigator.wakeLock.request('screen');
                }
            });
        } else {
            console.warn('Wake Lock API tidak didukung di browser ini.');
            wakeLockStatus.innerText = "Wake Lock: Tidak Didukung";
        }
    } catch (err) {
        console.error(`${err.name}, ${err.message}`);
    }
}

function releaseWakeLock() {
    if (wakeLock !== null) {
        wakeLock.release().then(() => {
            wakeLock = null;
            wakeLockStatus.innerText = "Wake Lock: Nonaktif";
            wakeLockStatus.classList.remove('active');
        });
    }
}

// Kontrol Utama
startBtn.onclick = async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        startMonitoring(stream);
        await requestWakeLock();
        
        startBtn.style.display = 'none';
        stopBtn.style.display = 'block';
    } catch (err) {
        alert('Gagal mengakses mikrofon. Pastikan perizinan diberikan.');
        console.error(err);
    }
};

stopBtn.onclick = () => {
    isMonitoring = false;
    if (isRecording) stopRecording();
    if (audioContext) audioContext.close();
    
    releaseWakeLock();
    
    startBtn.style.display = 'block';
    stopBtn.style.display = 'none';
};

function startMonitoring(stream) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;

    microphone = audioContext.createMediaStreamSource(stream);

    // Filter Audio Lanjutan: 
    // Menggunakan dua filter secara seri untuk isolasi lebih ketat
    // Filter 1: Highpass untuk memotong gemuruh/bass (< 300Hz)
    const highpass = audioContext.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 300; 

    // Filter 2: Lowpass untuk memotong desisan AC/Kipas (> 3400Hz)
    const lowpass = audioContext.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 3400;

    // Routing: Mic -> Highpass -> Lowpass -> Analyser & Recorder
    microphone.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(analyser);

    const filterStream = audioContext.createMediaStreamDestination();
    lowpass.connect(filterStream);
    mediaRecorder = new MediaRecorder(filterStream.stream);

    mediaRecorder.ondataavailable = e => {
        if (e.data.size > 0) audioChunks.push(e.data);
    };
    mediaRecorder.onstop = saveRecording;

    isMonitoring = true;
    detectSound();
    drawWaveform();
}

function detectSound() {
    if (!isMonitoring) return;
    requestAnimationFrame(detectSound);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    let sum = 0;
    for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
    const averageVolume = sum / bufferLength;

    if (averageVolume > THRESHOLD) {
        if (!isRecording) startRecording();
        clearTimeout(silenceTimer);
        silenceTimer = setTimeout(stopRecording, SILENCE_DURATION);
    }
}

function startRecording() {
    isRecording = true;
    audioChunks = [];
    mediaRecorder.start();
}

function stopRecording() {
    if (mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        isRecording = false;
    }
}

function saveRecording() {
    if (audioChunks.length === 0) return;
    
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    const audioUrl = URL.createObjectURL(audioBlob);
    const timestamp = new Date().toLocaleTimeString('id-ID', { hour12: false });
    
    const li = document.createElement('li');
    li.innerHTML = `
        <div>
            <strong>Aktivitas Terdeteksi</strong><br>
            <small style="color: #aaa;">Waktu: ${timestamp}</small>
        </div>
        <a href="${audioUrl}" download="SleepGuard_${timestamp}.webm" class="download-btn">Unduh Audio</a>
    `;
    
    // Animasi sederhana saat log baru masuk
    li.style.opacity = 0;
    logList.prepend(li);
    setTimeout(() => li.style.opacity = 1, 50);
}

function drawWaveform() {
    if (!isMonitoring) return;
    requestAnimationFrame(drawWaveform);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(dataArray);

    canvasCtx.fillStyle = '#1e1e1e';
    canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
    canvasCtx.lineWidth = 2;
    canvasCtx.strokeStyle = isRecording ? '#f44336' : '#4CAF50'; 
    canvasCtx.beginPath();

    const sliceWidth = canvas.width * 1.0 / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = v * canvas.height / 2;

        if (i === 0) canvasCtx.moveTo(x, y);
        else canvasCtx.lineTo(x, y);

        x += sliceWidth;
    }
    canvasCtx.lineTo(canvas.width, canvas.height / 2);
    canvasCtx.stroke();
}
