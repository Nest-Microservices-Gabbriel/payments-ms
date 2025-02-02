import { Inject, Injectable, Logger } from '@nestjs/common';
import { envs, NATS_SERVICE } from 'src/config';
import Stripe from 'stripe';
import { PaymentSessionDto } from './dto/payment-session.dto';
import { Request, Response } from 'express';
import { ClientProxy } from '@nestjs/microservices';

@Injectable()
export class PaymentsService {
  private readonly loogger = new Logger('PaymentsService');
  private readonly stripe = new Stripe(envs.strypeSecret);

  constructor(@Inject(NATS_SERVICE) private readonly natsClient: ClientProxy) {}

  async createPaymentSession(paymentSessionDto: PaymentSessionDto) {
    const { currency, items, orderId } = paymentSessionDto;

    const lineItems = items.map((item) => {
      return {
        price_data: {
          currency: currency,
          product_data: {
            name: item.name,
          },
          unit_amount: Math.round(item.price * 100), // 20 dolares 2000/100 = 20.00
        },
        quantity: item.quantity,
      };
    });

    const session = await this.stripe.checkout.sessions.create({
      // Colocar aqui el ID de mi orden
      payment_intent_data: {
        metadata: {
          orderId,
        },
      },
      line_items: lineItems,
      mode: 'payment',
      success_url: envs.strypeSuccessUrl,
      cancel_url: envs.strypeCancelsUrl,
    });

    //return session;
    return {
      cancelUrl: session.cancel_url,
      successUrl: session.success_url,
      url: session.url,
    };
  }

  async stripeWebhook(req: Request, res: Response) {
    const signature = req.headers['stripe-signature'];

    let event: Stripe.Event;

    /*
        testing
    const endpointSecret =
      'whsec_dd4d925bb2325ed372293f989a89f270060de137bd50304b4f1637b8e7932965';
    */
    const endpointSecret = envs.strypeEndpointSecret;
    try {
      event = this.stripe.webhooks.constructEvent(
        req['rawBody'],
        signature,
        endpointSecret,
      );
    } catch (error) {
      res.status(400).send(`Webhook Error: ${error.message}`);
      return;
    }

    //console.log({ event });

    switch (event.type) {
      case 'charge.succeeded':
        const chargeSucceeded = event.data.object;

        const payload = {
          stripePaymentId: chargeSucceeded.id,
          orderId: chargeSucceeded.metadata.orderId,
          receiptUrl: chargeSucceeded.receipt_url,
        };

        //this.loogger.log({ payload });

        this.natsClient.emit('payment.succeeded', payload);

        // Esta informacion es la que me regresa el webhook
        break;

      default:
        console.log(`Event ${event.type} not handled`);
        break;
    }

    return res.status(200).json(signature);
  }
}
