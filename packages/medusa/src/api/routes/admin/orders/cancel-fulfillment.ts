import {
  FulfillmentService,
  OrderService,
  ProductVariantInventoryService,
} from "../../../../services"
import { defaultAdminOrdersFields, defaultAdminOrdersRelations } from "."

import { EntityManager } from "typeorm"
import { MedusaError } from "medusa-core-utils"
import { Fulfillment } from "../../../../models"

/**
 * @oas [post] /orders/{id}/fulfillments/{fulfillment_id}/cancel
 * operationId: "PostOrdersOrderFulfillmentsCancel"
 * summary: "Cancels a Fulfilmment"
 * description: "Registers a Fulfillment as canceled."
 * x-authenticated: true
 * parameters:
 *   - (path) id=* {string} The ID of the Order which the Fulfillment relates to.
 *   - (path) fulfillment_id=* {string} The ID of the Fulfillment
 * x-codeSamples:
 *   - lang: JavaScript
 *     label: JS Client
 *     source: |
 *       import Medusa from "@medusajs/medusa-js"
 *       const medusa = new Medusa({ baseUrl: MEDUSA_BACKEND_URL, maxRetries: 3 })
 *       // must be previously logged in or use api token
 *       medusa.admin.orders.cancelFulfillment(order_id, fulfillment_id)
 *       .then(({ order }) => {
 *         console.log(order.id);
 *       });
 *   - lang: Shell
 *     label: cURL
 *     source: |
 *       curl --location --request POST 'https://medusa-url.com/admin/orders/{id}/fulfillments/{fulfillment_id}/cancel' \
 *       --header 'Authorization: Bearer {api_token}'
 * security:
 *   - api_token: []
 *   - cookie_auth: []
 * tags:
 *   - Fulfillment
 * responses:
 *   200:
 *     description: OK
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             order:
 *               $ref: "#/components/schemas/Order"
 *   "400":
 *     $ref: "#/components/responses/400_error"
 *   "401":
 *     $ref: "#/components/responses/unauthorized"
 *   "404":
 *     $ref: "#/components/responses/not_found_error"
 *   "409":
 *     $ref: "#/components/responses/invalid_state_error"
 *   "422":
 *     $ref: "#/components/responses/invalid_request_error"
 *   "500":
 *     $ref: "#/components/responses/500_error"
 */
export default async (req, res) => {
  const { id, fulfillment_id } = req.params

  const orderService: OrderService = req.scope.resolve("orderService")
  const productVariantInventoryService: ProductVariantInventoryService =
    req.scope.resolve("productVariantInventoryService")

  const fulfillmentService: FulfillmentService =
    req.scope.resolve("fulfillmentService")

  const fulfillment = await fulfillmentService.retrieve(fulfillment_id)

  if (fulfillment.order_id !== id) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `no fulfillment was found with the id: ${fulfillment_id} related to order: ${id}`
    )
  }

  const manager: EntityManager = req.scope.resolve("manager")
  await manager.transaction(async (transactionManager) => {
    await orderService
      .withTransaction(transactionManager)
      .cancelFulfillment(fulfillment_id)

    const fulfillment = await fulfillmentService
      .withTransaction(transactionManager)
      .retrieve(fulfillment_id, { relations: ["items", "items.item"] })

    await adjustInventoryForCancelledFulfillment(fulfillment, {
      productVariantInventoryService:
        productVariantInventoryService.withTransaction(transactionManager),
    })
  })

  const order = await orderService.retrieve(id, {
    select: defaultAdminOrdersFields,
    relations: defaultAdminOrdersRelations,
  })

  res.json({ order })
}

export const adjustInventoryForCancelledFulfillment = async (
  fulfillment: Fulfillment,
  context: {
    productVariantInventoryService: ProductVariantInventoryService
  }
) => {
  const { productVariantInventoryService } = context
  await Promise.all(
    fulfillment.items.map(async ({ item, quantity }) => {
      if (item.variant_id) {
        await productVariantInventoryService.adjustInventory(
          item.variant_id,
          fulfillment.location_id!,
          quantity
        )
      }
    })
  )
}
