import { Injectable, signal, computed } from '@angular/core';
import { CartItem, ProductSize, Addon } from '../models';

@Injectable({
  providedIn: 'root'
})
export class CartService {
  items = signal<CartItem[]>([]);

  subtotal = computed(() => this.items().reduce((acc, item) => acc + item.total_price, 0));
  
  itemCount = computed(() => this.items().reduce((acc, item) => acc + item.quantity, 0));

  addItem(product_id: string, product_name: string, size: ProductSize, addons: Addon[], quantity: number) {
    const itemPrice = (size.price + addons.reduce((sum, addon) => sum + addon.price, 0)) * quantity;
    
    const newItem: CartItem = {
      product_id,
      product_name,
      size,
      addons,
      quantity,
      total_price: itemPrice
    };

    this.items.update(currentItems => [...currentItems, newItem]);
  }

  removeItem(index: number) {
    this.items.update(currentItems => currentItems.filter((_, i) => i !== index));
  }
  
  incrementItem(index: number) {
      this.items.update(items => {
          const item = items[index];
          if(item) {
              const newQuantity = item.quantity + 1;
              const unitPrice = item.total_price / item.quantity;
              item.quantity = newQuantity;
              item.total_price = unitPrice * newQuantity;
          }
          return [...items];
      });
  }

  decrementItem(index: number) {
       this.items.update(items => {
          const item = items[index];
          if(item && item.quantity > 1) {
              const newQuantity = item.quantity - 1;
              const unitPrice = item.total_price / item.quantity;
              item.quantity = newQuantity;
              item.total_price = unitPrice * newQuantity;
          }
          return [...items];
      });
  }

  clearCart() {
    this.items.set([]);
  }
}