export const BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://api.brepline.com/v1";

export const MATERIALS = ["AL6061", "STEEL", "STAINLESS", "TITANIUM", "ABS", "PLA"];
export const FORMATS = ["step", "stl"];
export const UNITS = ["mm", "cm", "in"];

export const EXAMPLES = [
  { tag: "Bracket", text: "L-bracket 60 mm wide, 40 mm base, 40 mm tall, 5 mm thick, two 6 mm mounting holes in the base" },
  { tag: "Gear", text: "Create a 24-tooth spur gear, module 2, 10 mm bore, 8 mm thick" },
  { tag: "Enclosure", text: "Electronics enclosure 80 x 50 x 30 mm, 2 mm walls, open top, USB cutout on one side" },
  { tag: "Flange", text: "Pipe flange 100 mm diameter, 10 mm thick, 40 mm bore, 4 bolt holes of 6 mm on a 70 mm circle" },
];

// Placeholder plan data. Replace with your real pricing.
export const PLAN = { name: "Free", credits: 50, used: 12, rate: 10 };
