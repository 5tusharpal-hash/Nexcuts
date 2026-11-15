import type { FastifyPluginAsync } from 'fastify';
import { AuthMiddleware } from '../auth/auth.middleware.js';
import { RbacMiddleware } from '../rbac/rbac.middleware.js';
import { GalleryController } from './gallery.controller.js';
import { GalleryService } from './gallery.service.js';
import { ServicesController } from './services.controller.js';
import { ServicesService } from './services.service.js';

const authMiddleware = new AuthMiddleware();
const rbacMiddleware = new RbacMiddleware();

export const salonServicesRoutes: FastifyPluginAsync = async (app) => {
  const servicesController = new ServicesController(new ServicesService());
  const galleryController = new GalleryController(new GalleryService());
  const authenticate = (
    request: Parameters<typeof authMiddleware.verifyToken>[0],
    reply: Parameters<typeof authMiddleware.verifyToken>[1]
  ) => authMiddleware.verifyToken(request, reply);
  const manageServices = rbacMiddleware.check('services:manage');
  const manageGallery = rbacMiddleware.check('gallery:manage');
  const serviceManager = { preHandler: [authenticate, manageServices] };
  const galleryManager = { preHandler: [authenticate, manageGallery] };

  app.get('/salons/:salonId/services', (request) =>
    servicesController.listPublic(request)
  );
  app.get('/salons/:salonId/services/:serviceId', (request) =>
    servicesController.getPublic(request)
  );
  app.get('/salons/:salonId/service-catalog', serviceManager, (request) =>
    servicesController.listCatalog(request)
  );
  app.post(
    '/salons/:salonId/services',
    { ...serviceManager, bodyLimit: 3 * 1024 * 1024 },
    (request, reply) => servicesController.create(request, reply)
  );
  app.patch('/salons/:salonId/services/:serviceId', serviceManager, (request) =>
    servicesController.update(request)
  );
  app.delete('/salons/:salonId/services/:serviceId', serviceManager, (request, reply) =>
    servicesController.archive(request, reply)
  );
  app.put(
    '/salons/:salonId/services/:serviceId/image',
    { ...serviceManager, bodyLimit: 3 * 1024 * 1024 },
    (request) => servicesController.setImage(request)
  );
  app.delete('/salons/:salonId/services/:serviceId/image', serviceManager, (request) =>
    servicesController.clearImage(request)
  );

  app.get('/salons/:salonId/service-categories', serviceManager, (request) =>
    servicesController.listCategories(request)
  );
  app.post('/salons/:salonId/service-categories', serviceManager, (request, reply) =>
    servicesController.createCategory(request, reply)
  );
  app.patch(
    '/salons/:salonId/service-categories/:categoryId',
    serviceManager,
    (request) => servicesController.updateCategory(request)
  );
  app.delete(
    '/salons/:salonId/service-categories/:categoryId',
    serviceManager,
    (request, reply) => servicesController.archiveCategory(request, reply)
  );
  app.get('/salons/:salonId/service-default-images', serviceManager, (request) =>
    servicesController.listDefaultImages(request)
  );

  app.get('/platform/service-image-settings', { preHandler: [authenticate] }, (request) =>
    servicesController.getImageSettings(request)
  );
  app.put('/platform/service-image-settings', { preHandler: [authenticate] }, (request) =>
    servicesController.updateImageSettings(request)
  );
  app.post(
    '/platform/service-default-images',
    { preHandler: [authenticate], bodyLimit: 3 * 1024 * 1024 },
    (request, reply) => servicesController.createDefaultImage(request, reply)
  );
  app.patch(
    '/platform/service-default-images/:defaultImageId',
    { preHandler: [authenticate] },
    (request) => servicesController.updateDefaultImage(request)
  );

  app.get('/salons/:salonId/gallery/public', (request) =>
    galleryController.listPublicImages(request)
  );
  app.get('/salons/:salonId/gallery/quota', galleryManager, (request) =>
    galleryController.getQuota(request)
  );
  app.get('/salons/:salonId/gallery/categories', galleryManager, (request) =>
    galleryController.listCategories(request)
  );
  app.post('/salons/:salonId/gallery/categories', galleryManager, (request, reply) =>
    galleryController.createCategory(request, reply)
  );
  app.patch(
    '/salons/:salonId/gallery/categories/:categoryId',
    galleryManager,
    (request) => galleryController.updateCategory(request)
  );
  app.delete(
    '/salons/:salonId/gallery/categories/:categoryId',
    galleryManager,
    (request, reply) => galleryController.archiveCategory(request, reply)
  );
  app.get('/salons/:salonId/gallery/images', galleryManager, (request) =>
    galleryController.listImages(request)
  );
  app.post(
    '/salons/:salonId/gallery/images',
    { ...galleryManager, bodyLimit: 6 * 1024 * 1024 },
    (request, reply) => galleryController.createImage(request, reply)
  );
  app.patch(
    '/salons/:salonId/gallery/images/:imageId',
    galleryManager,
    (request) => galleryController.updateImage(request)
  );
  app.delete(
    '/salons/:salonId/gallery/images/:imageId',
    galleryManager,
    (request, reply) => galleryController.archiveImage(request, reply)
  );
  app.put(
    '/platform/salons/:salonId/entitlement-overrides/public-gallery-limit',
    { preHandler: [authenticate] },
    (request) => galleryController.setQuotaOverride(request)
  );
};
