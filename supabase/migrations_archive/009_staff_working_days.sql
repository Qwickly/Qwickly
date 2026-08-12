-- Add staff working days (used to restrict public booking date selection)

ALTER TABLE public.staff_members
ADD COLUMN IF NOT EXISTS working_days TEXT[] NOT NULL DEFAULT ARRAY[
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday'
];

