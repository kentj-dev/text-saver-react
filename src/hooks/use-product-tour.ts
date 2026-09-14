import { useCallback, useEffect, useRef } from 'react';
import { driver, type Driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';

const TOUR_STEPS: DriveStep[] = [
  {
    element: '[data-tour="welcome"]',
    popover: {
      title: 'Welcome to Text Saver',
      description: 'Save, organize, protect, and move snippets without leaving your browser.',
      side: 'bottom',
      align: 'start',
    },
  },
  {
    element: '[data-tour="tabs"]',
    popover: {
      title: 'Organize with tabs',
      description: 'Switch tabs, drag to reorder them, or right-click a tab for more actions.',
      side: 'bottom',
      align: 'start',
    },
  },
  {
    element: '[data-tour="editor"]',
    popover: {
      title: 'Write and autosave',
      description: 'Your text is saved locally as you type. The header reports when a save is in progress.',
      side: 'top',
      align: 'center',
    },
  },
  {
    element: '[data-tour="security"]',
    skipMissingElement: true,
    popover: {
      title: 'Protect sensitive tabs',
      description: 'Add a password to encrypt a tab. Unlocked tabs lock automatically after two minutes.',
      side: 'bottom',
      align: 'end',
    },
  },
  {
    element: '[data-tour="find"]',
    popover: {
      title: 'Find text quickly',
      description: 'Search within the active tab and jump through every match.',
      side: 'bottom',
      align: 'end',
    },
  },
  {
    element: '[data-tour="actions"]',
    popover: {
      title: 'Copy or download',
      description: 'Copy the current tab or download it as a text file. Click a line number to copy one line.',
      side: 'top',
      align: 'end',
    },
  },
  {
    element: '[data-tour="more"]',
    popover: {
      title: 'Backups, Plus, and cloud sync',
      description: 'Open this menu to manage Plus, sync up to five tabs, import or export backups, and replay this guide.',
      side: 'bottom',
      align: 'end',
    },
  },
];

export function useProductTour() {
  const tourRef = useRef<Driver | null>(null);
  const frameRef = useRef<number | null>(null);

  const startTour = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    tourRef.current?.destroy();
    const tour = driver({
      steps: TOUR_STEPS,
      showProgress: true,
      progressText: '{{current}} of {{total}}',
      nextBtnText: 'Next',
      prevBtnText: 'Back',
      doneBtnText: 'Done',
      allowClose: true,
      allowKeyboardControl: true,
      skipMissingElement: true,
      stagePadding: 6,
      stageRadius: 10,
      overlayOpacity: 0.72,
      popoverClass: 'text-saver-tour',
      onDestroyed: () => { tourRef.current = null; },
    });
    tourRef.current = tour;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      tour.drive();
    });
  }, []);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    tourRef.current?.destroy();
  }, []);
  return startTour;
}
