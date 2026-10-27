export type Category = {
  slug: string;
  name: string;
  tagline: string;
  icon: string; // lucide icon key
  image: string; // unsplash url
  color: string; // tailwind gradient
  servicesCount: number;
};

export type Service = {
  slug: string;
  title: string;
  category: string; // category slug
  price: number;
  mrp: number;
  rating: number;
  reviews: number;
  durationMin: number;
  image: string;
  badge?: string;
  description: string;
  includes: string[];
  faqs: { q: string; a: string }[];
  bookingUnit?: string;
  preparation?: string[];
  exclusions?: string[];
  serviceSteps?: { title: string; description: string }[];
};

export type Professional = {
  id: string;
  name: string;
  avatar: string;
  rating: number;
  jobs: number;
  skills: string[];
};

export type CartItem = {
  slug: string;
  qty: number;
  slot?: string;
};

export type Booking = {
  id: string;
  items: { slug: string; title: string; price: number; qty: number; durationMin?: number }[];
  total: number;
  subtotal: number;
  discount: number;
  visitFee: number;
  name: string;
  phone: string;
  address: string;
  date: string;
  slot: string;
  payment: string;
  status: "confirmed" | "pending" | "completed" | "cancelled" | "in_progress";
  createdAt: string;
  userId?: string;
  paymentStatus?: "unpaid" | "paid" | "failed" | "refunded" | "refund_pending";
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  paymentProvider?: "stripe" | "razorpay";
  stripeSessionId?: string;
  stripePaymentIntentId?: string;
  stripeCheckoutUrl?: string;
  refundStatus?: "pending" | "processing" | "succeeded" | "failed";
  refundMessage?: string;
  refundId?: string;
  updatedAt?: string;
};

export type User = {
  id: string;
  email: string;
  name: string;
  role: import("./roles").UserRole;
  createdAt: string;
};
