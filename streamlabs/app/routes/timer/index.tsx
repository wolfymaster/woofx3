import { id, i, init, InstaQLEntity } from "@instantdb/react";
import { useSearchParams } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";

const APP_ID = "8c28dd52-4859-4560-8d45-2408b064b248";

const schema = i.schema({
    entities: {
        timers: i.entity({
            expirationDate: i.string(),
        }),
    },
});

const db = init({ appId: APP_ID, schema });


export default function Timer() {
    const [searchParams] = useSearchParams();
    const { isLoading, error, data } = db.useQuery({
        timers: {
            $: {
                where: {
                    id: searchParams.get('timerId') || ''
                }
            }
        }
    });
    const [timeLeft, setTimeLeft] = useState({
        hours: 0,
        minutes: 0,
        seconds: 0
    });
    const [inputTime, setInputTime] = useState({
        hours: 0,
        minutes: 0,
        seconds: 0
    });
    const [isRunning, setIsRunning] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const intervalRef = useRef(null);

    // Format digits to always show two digits
    const formatDigit = (digit: number) => {
        return digit.toString().padStart(2, '0');
    };

    // Calculate total seconds left
    const calculateTotalSeconds = () => {
        return timeLeft.hours * 3600 + timeLeft.minutes * 60 + timeLeft.seconds;
    };

    // Convert seconds to HH:MM:SS format
    const secondsToTime = (totalSeconds: number) => {
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        return { hours, minutes, seconds };
    };

    // Start the timer
    const startTimer = () => {
        // Set time from input
        setTimeLeft(inputTime);
        setIsRunning(true);
        setIsPaused(false);
    };

    // Pause the timer
    const pauseTimer = () => {
        setIsPaused(true);
    };

    // Resume the timer
    const resumeTimer = () => {
        setIsPaused(false);
    };

    // Reset the timer
    const resetTimer = () => {
        setIsRunning(false);
        setIsPaused(false);
        setTimeLeft({ hours: 0, minutes: 0, seconds: 0 });
    };

    function getTimeDifference(startDate: Date, endDate: Date) {
        // Calculate the difference in milliseconds
        const diffInMs = endDate - startDate;
        
        // Convert to seconds
        const diffInSeconds = Math.floor(diffInMs / 1000);
        
        // Calculate hours, minutes, and seconds
        const hours = Math.floor(diffInSeconds / 3600);
        const minutes = Math.floor((diffInSeconds % 3600) / 60);
        const seconds = diffInSeconds % 60;
        
        return {
          hours,
          minutes,
          seconds
        };
      }

    useEffect(() => {
        if (isRunning && !isPaused) {
          intervalRef.current = setInterval(() => {
            const totalSeconds = calculateTotalSeconds();
            
            if (totalSeconds <= 0) {
              clearInterval(intervalRef.current);
              setIsRunning(false);
              return;
            }
            
            console.log(secondsToTime(totalSeconds - 1));

            setTimeLeft(secondsToTime(totalSeconds - 1));
          }, 1000);
        } else {
          clearInterval(intervalRef.current);
        }
    
        // Cleanup on unmount
        return () => clearInterval(intervalRef.current);
      }, [isRunning, isPaused, timeLeft]);

    useEffect(() => {
        if (!data?.timers[0].expirationDate) {
            return;
        }

        const expDate = new Date(data?.timers[0].expirationDate);
        
        let now = new Date();
        const remainingTime = getTimeDifference(now, expDate);
        setInputTime(remainingTime);
    }, [data])

    useEffect(() => {
        startTimer();
    }, [inputTime])

    if (isLoading) {
        return <></>;
    }

    if (data?.timers.length == 0) {
        return <>Invalid Timer Id</>
    }

    return (
        <div id="timer">
            {formatDigit(timeLeft.hours)}:{formatDigit(timeLeft.minutes)}:{formatDigit(timeLeft.seconds)}
        </div>
    )
}