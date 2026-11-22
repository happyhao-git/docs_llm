import 'fastify'

declare module 'fastify' {
  interface FastifyRequest {
    admin?: {
      id: number
      username: string
    }
  }
}
