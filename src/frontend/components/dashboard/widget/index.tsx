"use client";

import React, { useState, useEffect, memo } from "react";
import { Card, CardContent } from "@/frontend/components/ui/card";
import { Badge } from "@/frontend/components/ui/badge";
import TVNoise from "@/frontend/components/ui/tv-noise";

// Memoize Widget to prevent re-renders of parent components
// The clock updates every second internally, but shouldn't trigger parent re-renders
function Widget() {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [userTimezone, setUserTimezone] = useState<string>('');
  const [utcOffset, setUtcOffset] = useState<string>('');
  const [userLocation, setUserLocation] = useState<string>('');
  const [temperature, setTemperature] = useState<string>('');

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    // Get user's timezone
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setUserTimezone(timezone);
    
    // Calculate UTC offset
    const offsetMinutes = -new Date().getTimezoneOffset();
    const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
    const offsetMins = Math.abs(offsetMinutes) % 60;
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const utcOffsetString = `UTC${sign}${offsetHours}${offsetMins > 0 ? ':' + offsetMins.toString().padStart(2, '0') : ''}`;
    setUtcOffset(utcOffsetString);

    // Get approximate location from IP address (no permissions needed)
    const fetchLocationAndWeather = async () => {
      try {
        // Use IP-based geolocation (free, no API key, no permissions)
        const geoResponse = await fetch('https://get.geojs.io/v1/ip/geo.json');
        const geoData = await geoResponse.json();
        
        if (geoData.city || geoData.region) {
          const city = (geoData.city || '').trim();
          const region = (geoData.region || '').trim();

          if (city && region) {
            // Avoid duplicates like "Belgrade, Belgrade"
            if (city.toLowerCase() === region.toLowerCase()) {
              setUserLocation(city);
            } else {
              setUserLocation(`${city}, ${region}`);
            }
          } else if (city) {
            setUserLocation(city);
          } else if (region) {
            setUserLocation(region);
          }
        }

        // Fetch weather data if we have coordinates
        if (geoData.latitude && geoData.longitude) {
          try {
            const weatherResponse = await fetch(
              `https://api.open-meteo.com/v1/forecast?latitude=${geoData.latitude}&longitude=${geoData.longitude}&current=temperature_2m&temperature_unit=celsius`
            );
            const weatherData = await weatherResponse.json();
            if (weatherData.current?.temperature_2m) {
              setTemperature(`${Math.round(weatherData.current.temperature_2m)}°C`);
            }
          } catch (error) {
            console.error('Error fetching weather:', error);
          }
        }
      } catch (error) {
        console.error('Error fetching IP-based location:', error);
        // Fallback to timezone-based location
        const locationParts = timezone.split('/');
        const city = locationParts[locationParts.length - 1].replace(/_/g, ' ');
        setUserLocation(city);
      }
    };

    fetchLocationAndWeather();
  }, []);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("en-US", {
      hour12: true,
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const formatDate = (date: Date) => {
    const dayOfWeek = date.toLocaleDateString("en-US", {
      weekday: "long",
    });
    const restOfDate = date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    return { dayOfWeek, restOfDate };
  };

  const dateInfo = formatDate(currentTime);

  return (
    <Card className="w-full aspect-[2] relative overflow-hidden">
      <TVNoise opacity={0.3} intensity={0.2} speed={40} />
      <CardContent className="bg-accent/30 flex-1 flex flex-col justify-between text-sm font-medium uppercase relative z-20">
        <div className="flex justify-between items-center">
          <span className="opacity-50">{dateInfo.dayOfWeek}</span>
          <span>{dateInfo.restOfDate}</span>
        </div>
        <div className="text-center">
          <div className="text-5xl font-display" suppressHydrationWarning>
            {formatTime(currentTime)}
          </div>
        </div>

        <div className="flex justify-between items-center">
          <span className="opacity-50">{temperature || '--°C'}</span>
          <span>{userLocation || 'Loading...'}</span>

          <Badge variant="secondary" className="bg-accent">
            {utcOffset || 'UTC'}
          </Badge>
        </div>

        <div className="absolute inset-0 -z-1">
          <img
            src="/assets/pc_blueprint.gif"
            alt="logo"
            className="size-full object-contain"
          />
        </div>
      </CardContent>
    </Card>
  );
}

// Export memoized version to prevent parent re-renders
export default memo(Widget);
