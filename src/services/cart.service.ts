import { Injectable, signal, computed } from '@angular/core';
import { CartItem, ProductSize, Addon } from '../models';

@Injectable({
  providedIn: 'root'
})
export class CartService {
  items = signal<CartItem[]>([]);

  subtotal = computed(() => this.items().reduce((acc, item) => acc + item.total_price, 0));
  
  itemCount = computed(() => this.items().reduce((acc, item) => acc + item.quantity, 0));

  addItem(product_id: string, product_name: string, size: ProductSize, addons: Addon[], quantity: number, notes?: string) {
    const itemPrice = (size.price + addons.reduce((sum, addon) => sum + addon.price, 0)) * quantity;
    
    const newItem: CartItem = {
      product_id,
      product_name,
      size,
      addons,
      quantity,
      total_price: itemPrice,
      notes
    };

    this.items.update(currentItems => [...currentItems, newItem]);
  }

  removeItem(index: number) {
    this.items.update(currentItems => currentItems.filter((_, i) => i !== index));
  }
  
  incrementItem(index: number) {
    this.items.update(items =>
      items.map((item, i) => {
        if (i !== index) {
          return item;
        }
        const unitPrice = item.quantity > 0 ? item.total_price / item.quantity : 0;
        const newQuantity = item.quantity + 1;
        return {
          ...item,
          quantity: newQuantity,
          total_price: unitPrice * newQuantity,
        };
      })
    );
  }

  decrementItem(index: number) {
    this.items.update(items =>
      items.map((item, i) => {
        if (i !== index || item.quantity <= 1) {
          return item;
        }
        const unitPrice = item.quantity > 0 ? item.total_price / item.quantity : 0;
        const newQuantity = item.quantity - 1;
        return {
          ...item,
          quantity: newQuantity,
          total_price: unitPrice * newQuantity,
        };
      })
    );
  }

  clearCart() {
    this.items.set([]);
  }
}