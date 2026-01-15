export interface DayOpeningHours {
  is_open: boolean;
  start: string;
  end: string;
}

export interface ShopSettings {
  id?: number;
  name: string;
  logo_url: string; // Will now store a public URL from Supabase Storage
  banner_url: string; // Will now store a public URL from Supabase Storage
  slider_images: string[]; // array of public URLs from Supabase Storage
  pdv_background_image_url?: string; // Will now store a public URL from Supabase Storage
  address: string;
  whatsapp: string;
  delivery_whatsapp?: string;
  instagram: string;
  facebook: string;
  welcome_message: string;
  wait_time: string;
  opening_hours: {
    monday: DayOpeningHours;
    tuesday: DayOpeningHours;
    wednesday: DayOpeningHours;
    thursday: DayOpeningHours;
    friday: DayOpeningHours;
    saturday: DayOpeningHours;
    sunday: DayOpeningHours;
  };
  delivery: {
    type: 'fixed' | 'neighborhood';
    fixed_fee: number;
    neighborhoods: NeighborhoodFee[];
  };
  pix_key: string;
  layout: {
    primary_color: string;
    accent_color: string;
    background_color: string;
    text_color: string;
    card_color: string;
    button_text_color: string;
    text_secondary_color: string;
    status_open_color: string;
    status_closed_color: string;
    header_text_color: string;
    category_text_color: string;
  };
  loyalty_program: {
    enabled: boolean;
    points_per_real: number;
    points_for_reward: number;
    reward_type: 'fixed' | 'free_shipping';
    reward_value: number;
  };
  is_temporarily_closed: boolean;
  temporary_closure_message: string;
  admin_username?: string;
  admin_password?: string;
}

export interface NeighborhoodFee {
  name: string;
  fee: number;
}

export interface Addon {
  id: string;
  name: string;
  price: number;
  order: number;
  is_available: boolean;
}

export interface AddonCategory {
  id: string;
  name: string;
  required: boolean;
  addons: Addon[];
  order: number;
  min_selection?: number;
  max_selection?: number;
}

export interface ProductSize {
  name: string;
  price: number;
  is_available: boolean;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  image_url: string; // Will now store a public URL from Supabase Storage
  category_id: string;
  price_type?: 'sized' | 'fixed';
  price?: number;
  sizes: ProductSize[];
  addon_categories: string[]; // array of AddonCategory ids
  order: number;
  is_available: boolean;
}

export interface Category {
  id: string;
  name: string;
  order: number;
}

export interface CartItem {
  product_id: string;
  product_name: string;
  size: ProductSize;
  addons: Addon[];
  quantity: number;
  total_price: number;
  notes?: string;
}

export interface Coupon {
  id: string;
  code: string;
  description: string;
  discount_type: 'percentage' | 'fixed' | 'free_shipping';
  discount_value: number;
  minimum_order_value?: number;
}

export type OrderStatus = 'Recebido' | 'Em Preparo' | 'Aguardando Retirada' | 'Saiu para Entrega' | 'Entregue' | 'Pago e Entregue' | 'Cancelado' | 'Agendado';

export type PaymentMethod = 'pix-machine' | 'card' | 'cash' | 'pix-online' | 'credit';

export interface Order {
  id: string;
  customer_name: string;
  delivery_option: 'delivery' | 'pickup' | 'counter'; // counter for PDV
  delivery_address?: string;
  neighborhood?: string;
  payment_method: PaymentMethod;
  change_for?: number;
  pix_proof_url?: string; // Will now store a public URL from Supabase Storage
  items: CartItem[];
  subtotal: number;
  delivery_fee: number;
  total: number;
  date: string;
  status: OrderStatus;
  scheduled_time?: string;
  coupon_code?: string;
  discount_amount?: number;
  shipping_discount_amount?: number;
  loyalty_discount_amount?: number;
  loyalty_shipping_discount_amount?: number;
  receivable_id?: string; // Link to receivable if payment_method is 'credit'
  assigned_driver_id?: string | null;
  assigned_driver_name?: string | null;
  is_delivery_broadcasted?: boolean;
}

export interface User {
  name: string;
  email: string;
  photo_url: string;
  loyalty_points: number;
  used_coupons?: string[];
}

export interface Receivable {
    id: string;
    order_id: string;
    customer_name: string;
    phone?: string;
    address?: string;
    payment_due_date: string;
    amount: number;
    status: 'pending' | 'paid';
    created_at: string;
}

export interface Expense {
    id: string;
    description: string;
    amount: number;
    date: string;
    category?: string;
}

export interface DeliveryDriver {
  id: string;
  name: string;
  whatsapp: string;
  address: string;
  cnh: string;
  password?: string;
  status: 'pending' | 'approved' | 'declined' | 'blocked';
}

export interface DriverPayment {
  id: string;
  driver_id: string;
  driver_name: string;
  amount: number;
  payment_date: string;
  notes?: string;
}