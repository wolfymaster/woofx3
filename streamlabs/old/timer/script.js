class CountdownTimer {
    constructor(elementId) {
        this.timerElement = document.getElementById(elementId);
        this.intervalId = null;
        this.endTime = null;
        
        // Load saved timer from local storage if it exists
        const savedEndTime = localStorage.getItem('timerEndTime');
        if (savedEndTime) {
            this.startFromSavedTime(parseInt(savedEndTime));
        }
    }

    startFromSavedTime(endTime) {
        const now = Date.now();
        if (endTime > now) {
            this.endTime = endTime;
            this.start();
        } else {
            this.clear();
        }
    }

    setDuration(seconds) {
        const now = Date.now();
        this.endTime = now + (seconds * 1000);
        localStorage.setItem('timerEndTime', this.endTime.toString());
        this.start();
    }

    start() {
        // Clear any existing interval
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }

        this.intervalId = setInterval(() => {
            const now = Date.now();
            const timeLeft = this.endTime - now;

            if (timeLeft <= 0) {
                this.clear();
                this.timerElement.textContent = '00:00:00';
                return;
            }

            const hours = Math.floor(timeLeft / (1000 * 60 * 60));
            const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);

            this.timerElement.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }, 1000);
    }

    clear() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.endTime = null;
        localStorage.removeItem('timerEndTime');
        this.timerElement.textContent = '00:00:00';
    }
}

// Initialize timer
const timer = new CountdownTimer('timer');

const start = document.getElementById('start');
const seconds = document.getElementById('seconds');
const reset = document.getElementById('reset');

// Event listener for setting duration
start.addEventListener('click', (event) => {
    timer.setDuration(seconds.value);
});

// Event listener for clearing timer
reset.addEventListener('click', () => {
    timer.clear();
});


// hide controls
start.style.display = 'none';
seconds.style.display = 'none';
reset.style.display = 'none';

if (false) {
    timer.setDuration(60 * 90);
}