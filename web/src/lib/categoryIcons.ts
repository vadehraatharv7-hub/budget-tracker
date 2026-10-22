import {
  Baby, Banknote, BookOpen, Briefcase, Bus, Car, Coffee, Droplets, Dumbbell, Film, Fuel, Gamepad2, Gift, GraduationCap, HeartPulse, House,
  Landmark, Music, Package, PawPrint, Plane, Receipt, Scissors, Shirt, ShoppingBag, ShoppingCart, Smartphone, Sofa, Stethoscope, Tag,
  Target, TrainFront, Tv, Utensils, Wifi, Wrench, Zap,
  type LucideIcon,
} from 'lucide-react';

/** Slug stored in the database -> icon. Categories only ever store a slug, never markup. */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  house: House,
  'shopping-cart': ShoppingCart,
  utensils: Utensils,
  'train-front': TrainFront,
  tv: Tv,
  'shopping-bag': ShoppingBag,
  'heart-pulse': HeartPulse,
  'graduation-cap': GraduationCap,
  plane: Plane,
  package: Package,
  car: Car,
  coffee: Coffee,
  gift: Gift,
  wifi: Wifi,
  smartphone: Smartphone,
  dumbbell: Dumbbell,
  baby: Baby,
  'paw-print': PawPrint,
  wrench: Wrench,
  music: Music,
  'gamepad-2': Gamepad2,
  briefcase: Briefcase,
  banknote: Banknote,
  receipt: Receipt,
  fuel: Fuel,
  bus: Bus,
  film: Film,
  shirt: Shirt,
  sofa: Sofa,
  scissors: Scissors,
  stethoscope: Stethoscope,
  'book-open': BookOpen,
  droplets: Droplets,
  zap: Zap,
  landmark: Landmark,
  target: Target,
  tag: Tag,
};

export const CATEGORY_ICON_SLUGS = Object.keys(CATEGORY_ICONS);
export const iconFor = (slug: string): LucideIcon => CATEGORY_ICONS[slug] ?? Tag;

/** Muted categorical palette (validated for adjacent-pair separation in light and dark). */
export const CATEGORY_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948', '#8b8a85'];
