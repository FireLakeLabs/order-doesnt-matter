export function controlInfo(name: string) {
  name = name === "cutoff" ? "lpf" : name === "hcutoff" ? "hpf" : name;
  return (
    (
      {
        lpf: {
          name: "Low-pass cutoff",
          unit: "Hz",
          min: 20,
          max: 16000,
          step: 10,
        },
        hpf: {
          name: "High-pass cutoff",
          unit: "Hz",
          min: 20,
          max: 16000,
          step: 10,
        },
        delaytime: {
          name: "Delay time",
          unit: "seconds",
          min: 0,
          max: 2,
          step: 0.01,
        },
        delayfeedback: {
          name: "Delay feedback",
          unit: "×",
          min: 0,
          max: 0.95,
          step: 0.01,
        },
        delay: { name: "Delay send", unit: "×", min: 0, max: 1, step: 0.01 },
        release: {
          name: "Release",
          unit: "seconds",
          min: 0,
          max: 4,
          step: 0.01,
        },
        crush: { name: "Bit depth", unit: "bits", min: 1, max: 16, step: 1 },
        distort: { name: "Distortion", unit: "×", min: 0, max: 10, step: 0.1 },
        note: { name: "Pitch", unit: "MIDI", min: 0, max: 127, step: 1 },
        gain: { name: "Gain", unit: "×", min: 0, max: 2, step: 0.01 },
        pan: {
          name: "Pan · left → right",
          unit: "",
          min: 0,
          max: 1,
          step: 0.01,
        },
        room: { name: "Reverb send", unit: "×", min: 0, max: 1, step: 0.01 },
        roomsize: {
          name: "Room size",
          unit: "seconds",
          min: 0.1,
          max: 4,
          step: 0.1,
        },
        orbit: {
          name: "Shared room number",
          unit: "room",
          min: 1,
          max: 16,
          step: 1,
        },
      } as Record<
        string,
        { name: string; unit: string; min: number; max: number; step: number }
      >
    )[name] ?? { name, unit: "value", min: 0, max: 10, step: 0.01 }
  );
}
