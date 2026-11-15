import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../../bootstrap/db.connect.js';
import { DiscoveryController } from './discovery.controller.js';
import { DiscoveryRepository } from './discovery.repository.js';
import { DiscoveryService } from './discovery.service.js';

export const discoveryRoutes: FastifyPluginAsync = async (app) => {
    const controller = new DiscoveryController(
        new DiscoveryService(new DiscoveryRepository(pool))
    );

    app.get('/public/salons/search', (request) => controller.searchPublicSalons(request));
    app.get('/public/salons/:slug', (request) => controller.getProfile(request));
    app.get('/public/salons/:slug/gallery', (request) => controller.getGallery(request));
};
