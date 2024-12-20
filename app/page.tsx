"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import ActionToolbar from "@/components/ActionToolbar"
import SpaceBuilder from "@/components/SpaceBuilder"
import VideoRoom from "@/components/VideoRoom"
import { motion, AnimatePresence } from "framer-motion"
import { useVideoRoom } from "@/hooks/useVideoRoom"
import { Room, EventRoom, SponsorRoom, WorkshopRoom, SocialRoom } from "@/types/shared"
import { useRoom, usePeerIds, useDataMessage } from "@huddle01/react/hooks"
import Chat from '@/components/Chat'
import { RoomJoinDialog } from "@/components/RoomJoinDialog"

interface Avatar {
  id: string
  x: number
  y: number
  name?: string
  color: string
}

interface Viewport {
  x: number
  y: number
  width: number
  height: number
}

interface Velocity {
  x: number
  y: number
}

const AVATAR_SIZE = 24
const MOVE_SPEED = 5
const VELOCITY_DECAY = 0.8
const WORLD_WIDTH = 3200
const WORLD_HEIGHT = 2000
const TILE_SIZE = 100

const ROOM_LAYOUTS: Room[] = [
  {
    id: 'main-stage',
    name: 'Main Stage',
    x: WORLD_WIDTH/2 - 350,
    y: WORLD_HEIGHT/2 - 250,
    width: 700,
    height: 500,
    type: 'event',
    theme: { color: 'rgba(255, 64, 129, 0.25)' }
  } as EventRoom,
  {
    id: 'workshop-1',
    name: 'Workshop A',
    x: 250,
    y: WORLD_HEIGHT/2 - 450,
    width: 400,
    height: 300,
    type: 'workshop',
    theme: { color: 'rgba(76, 175, 80, 0.25)' }
  } as WorkshopRoom,
  {
    id: 'workshop-2',
    name: 'Workshop B',
    x: 250,
    y: WORLD_HEIGHT/2 + 150,
    width: 400,
    height: 300,
    type: 'workshop',
    theme: { color: 'rgba(156, 39, 176, 0.25)' }
  } as WorkshopRoom,
  {
    id: 'networking-north',
    name: 'Networking North',
    x: WORLD_WIDTH/2 - 250,
    y: 250,
    width: 500,
    height: 250,
    type: 'social',
    theme: { color: 'rgba(33, 150, 243, 0.25)' }
  } as SocialRoom,
  {
    id: 'networking-south',
    name: 'Networking South',
    x: WORLD_WIDTH/2 - 250,
    y: WORLD_HEIGHT - 500,
    width: 500,
    height: 250,
    type: 'social',
    theme: { color: 'rgba(33, 150, 243, 0.25)' }
  } as SocialRoom,
  ...Array.from({ length: 12 }, (_, i) => ({
    id: `sponsor-${i + 1}`,
    name: `Sponsor ${i + 1}`,
    x: WORLD_WIDTH - 900 + (i % 3) * 300 + Math.sin(Math.floor(i / 3) * Math.PI / 3) * 100,
    y: 400 + Math.floor(i / 3) * 250,
    width: 250,
    height: 160,
    type: 'sponsor' as const,
    theme: {
      color: `hsla(${i * 30}, 70%, 60%, 0.25)`
    }
  } as SponsorRoom))
]

const checkZone = (position: { x: number; y: number }): Room | null => {
  for (const room of ROOM_LAYOUTS) {
    if (
      position.x >= room.x &&
      position.x <= room.x + room.width &&
      position.y >= room.y &&
      position.y <= room.y + room.height
    ) {
      return room
    }
  }
  return null
}

export default function Home() {
  const [showSpaceBuilder, setShowSpaceBuilder] = useState(false)
  const [currentZone, setCurrentZone] = useState<Room | null>(null)
  const [playerAvatar, setPlayerAvatar] = useState<Avatar>({ 
    id: 'player', 
    x: WORLD_WIDTH/2, 
    y: WORLD_HEIGHT/2, 
    name: 'Player',
    color: 'red' 
  })
  const [viewport, setViewport] = useState<Viewport>({ 
    x: 0, 
    y: 0, 
    width: 0, 
    height: 0
  })
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const animationFrameId = useRef<number | null>(null)
  const keysPressed = useRef(new Set<string>())
  const [velocity, setVelocity] = useState<Velocity>({ x: 0, y: 0 })
  const { token, isLoading, error, createVideoRoom, joinVideoRoom } = useVideoRoom()
  const [activeVideoRoom, setActiveVideoRoom] = useState<string | null>(null)

  // Main environment room
  const ROOM_ID = "rov-ksqz-okz"; // Replace this with a valid roomId
  const [envToken, setEnvToken] = useState<string | null>(null);

  const { joinRoom, state, leaveRoom } = useRoom();
  const { peerIds } = usePeerIds();
  const [users, setUsers] = useState<{ [peerId: string]: { x: number; y: number; color: string } }>({});

  const { sendData } = useDataMessage({
    onMessage: useCallback((payload: string, from: string) => {
      try {
        const data = JSON.parse(payload);
        if (data.type === 'positionUpdate') {
          setUsers((prev) => ({
            ...prev,
            [from]: { x: data.x, y: data.y, color: data.color },
          }));
        }
      } catch (error) {
        console.error('Failed to parse data message:', error);
      }
    }, [])
  });

  // Fetch token for the main environment room
  useEffect(() => {
    async function fetchToken() {
      if (!ROOM_ID) return;
      try {
        const res = await fetch(`/api/huddle/token?roomId=${ROOM_ID}`);
        const data = await res.json();
        if (data.token) {
          setEnvToken(data.token);
        } else {
          console.error('No token returned for environment room');
        }
      } catch (err) {
        console.error('Failed to fetch env room token:', err);
      }
    }
    fetchToken();
  }, [ROOM_ID]);

  // Join the main environment room once token is available
  useEffect(() => {
    if (ROOM_ID && envToken) {
      joinRoom({ roomId: ROOM_ID, token: envToken });
    }
  }, [ROOM_ID, envToken, joinRoom]);

  useEffect(() => {
    setViewport(prev => ({
      ...prev,
      width: window.innerWidth,
      height: window.innerHeight
    }))
    setCanvasSize({
      width: window.innerWidth,
      height: window.innerHeight
    })
  }, [])

  const movePlayer = useCallback(() => {
    const newVelocity = { x: 0, y: 0 }
    let moved = false

    if (keysPressed.current.has('ArrowUp') || keysPressed.current.has('w')) {
      newVelocity.y -= MOVE_SPEED
      moved = true
    }
    if (keysPressed.current.has('ArrowDown') || keysPressed.current.has('s')) {
      newVelocity.y += MOVE_SPEED
      moved = true
    }
    if (keysPressed.current.has('ArrowLeft') || keysPressed.current.has('a')) {
      newVelocity.x -= MOVE_SPEED
      moved = true
    }
    if (keysPressed.current.has('ArrowRight') || keysPressed.current.has('d')) {
      newVelocity.x += MOVE_SPEED
      moved = true
    }

    if (newVelocity.x !== 0 && newVelocity.y !== 0) {
      const length = Math.sqrt(newVelocity.x * newVelocity.x + newVelocity.y * newVelocity.y)
      newVelocity.x = (newVelocity.x / length) * MOVE_SPEED
      newVelocity.y = (newVelocity.y / length) * MOVE_SPEED
    }

    if (!moved) {
      newVelocity.x = velocity.x * VELOCITY_DECAY
      newVelocity.y = velocity.y * VELOCITY_DECAY
    }

    setVelocity(newVelocity)

    const newPosition: Avatar = {
      ...playerAvatar,
      x: playerAvatar.x + newVelocity.x,
      y: playerAvatar.y + newVelocity.y
    }

    newPosition.x = Math.max(AVATAR_SIZE, Math.min(newPosition.x, WORLD_WIDTH - AVATAR_SIZE))
    newPosition.y = Math.max(AVATAR_SIZE, Math.min(newPosition.y, WORLD_HEIGHT - AVATAR_SIZE))
    
    setPlayerAvatar(newPosition)

    // Broadcast position to other peers
    if (state === 'connected') {
      sendData({
        to: '*',
        payload: JSON.stringify({
          type: 'positionUpdate',
          x: newPosition.x,
          y: newPosition.y,
          color: newPosition.color,
        }),
        label: 'pos',
      });
    }

    const targetX = newPosition.x - canvasSize.width / 2
    const targetY = newPosition.y - canvasSize.height / 2
    
    setViewport(prev => ({
      ...prev,
      x: Math.max(0, Math.min(targetX, WORLD_WIDTH - canvasSize.width)),
      y: Math.max(0, Math.min(targetY, WORLD_HEIGHT - canvasSize.height))
    }))
  }, [playerAvatar, velocity, canvasSize.width, canvasSize.height, sendData, state])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => keysPressed.current.add(e.key)
    const handleKeyUp = (e: KeyboardEvent) => keysPressed.current.delete(e.key)

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  const drawMinimap = useCallback((ctx: CanvasRenderingContext2D, viewport: Viewport, playerAvatar: Avatar) => {
    const minimapWidth = 180
    const minimapHeight = (WORLD_HEIGHT / WORLD_WIDTH) * minimapWidth
    const padding = 10
    
    // Draw minimap background
    ctx.fillStyle = 'rgba(26, 26, 46, 0.9)'
    ctx.shadowColor = 'rgba(0, 0, 0, 0.2)'
    ctx.shadowBlur = 10
    ctx.beginPath()
    ctx.roundRect(padding, padding, minimapWidth, minimapHeight, 8)
    ctx.fill()
    
    const scale = minimapWidth / WORLD_WIDTH
    
    // Draw rooms in minimap
    ROOM_LAYOUTS.forEach((room) => {
      ctx.fillStyle = room.theme?.color || 'rgba(255, 255, 255, 0.2)'
      ctx.beginPath()
      ctx.roundRect(
        padding + room.x * scale,
        padding + room.y * scale,
        room.width * scale,
        room.height * scale,
        2
      )
      ctx.fill()
    })
    
    // Draw viewport area
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'
    ctx.lineWidth = 1
    ctx.strokeRect(
      padding + viewport.x * scale,
      padding + viewport.y * scale,
      viewport.width * scale,
      viewport.height * scale
    )
    
    // Draw player position
    ctx.shadowColor = playerAvatar.color
    ctx.shadowBlur = 5
    ctx.fillStyle = playerAvatar.color
    ctx.beginPath()
    ctx.arc(
      padding + playerAvatar.x * scale,
      padding + playerAvatar.y * scale,
      3,
      0,
      2 * Math.PI
    )
    ctx.fill()
  }, [])

  useEffect(() => {
    const animate = () => {
      movePlayer()
      const ctx = canvasRef.current?.getContext('2d')
      if (!ctx) return

      ctx.clearRect(0, 0, canvasSize.width, canvasSize.height)

      ctx.save()
      ctx.translate(-viewport.x, -viewport.y)

      // Draw gradient background
      const gradient = ctx.createLinearGradient(viewport.x, viewport.y, viewport.x + canvasSize.width, viewport.y + canvasSize.height)
      gradient.addColorStop(0, '#1a1a2e')
      gradient.addColorStop(1, '#16213e')
      ctx.fillStyle = gradient
      ctx.fillRect(viewport.x, viewport.y, canvasSize.width, canvasSize.height)

      // Draw grid with improved style
      const gridOffsetX = viewport.x % TILE_SIZE
      const gridOffsetY = viewport.y % TILE_SIZE
      
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)'
      ctx.lineWidth = 1
      ctx.beginPath()

      for (let x = viewport.x - gridOffsetX; x <= viewport.x + canvasSize.width; x += TILE_SIZE) {
        ctx.moveTo(x, viewport.y)
        ctx.lineTo(x, viewport.y + canvasSize.height)
      }

      for (let y = viewport.y - gridOffsetY; y <= viewport.y + canvasSize.height; y += TILE_SIZE) {
        ctx.moveTo(viewport.x, y)
        ctx.lineTo(viewport.x + canvasSize.width, y)
      }
      ctx.stroke()

      // Draw rooms with glass morphism effect
      ROOM_LAYOUTS.forEach((room) => {
        // Draw room background with blur effect simulation
        ctx.fillStyle = room.theme?.color || 'rgba(255, 255, 255, 0.1)'
        ctx.shadowColor = 'rgba(255, 255, 255, 0.1)'
        ctx.shadowBlur = 15
        ctx.beginPath()
        ctx.roundRect(room.x, room.y, room.width, room.height, 10)
        ctx.fill()

        // Draw room border
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)'
        ctx.lineWidth = currentZone?.id === room.id ? 3 : 1
        ctx.stroke()

        // Draw room name with improved typography
        ctx.shadowBlur = 0
        ctx.fillStyle = 'white'
        ctx.font = 'bold 16px Inter, system-ui'
        ctx.textAlign = 'center'
        ctx.fillText(room.name, room.x + room.width/2, room.y + room.height/2)
        
        // Draw room type label
        ctx.font = '12px Inter, system-ui'
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'
        ctx.fillText(room.type.toUpperCase(), room.x + room.width/2, room.y + room.height/2 + 20)
      })

      // Draw player avatar with glow effect
      ctx.shadowColor = playerAvatar.color
      ctx.shadowBlur = 15
      ctx.fillStyle = playerAvatar.color
      ctx.beginPath()
      ctx.arc(playerAvatar.x, playerAvatar.y, AVATAR_SIZE/2, 0, Math.PI * 2)
      ctx.fill()

      // Draw other users with glow effect
      peerIds.forEach((pid) => {
        const user = users[pid]
        if (user) {
          ctx.shadowColor = user.color
          ctx.shadowBlur = 15
          ctx.fillStyle = user.color
          ctx.beginPath()
          ctx.arc(user.x, user.y, AVATAR_SIZE/2, 0, Math.PI * 2)
          ctx.fill()
        }
      })

      ctx.restore()

      // Draw enhanced minimap
      drawMinimap(ctx, viewport, playerAvatar)

      animationFrameId.current = requestAnimationFrame(animate)
    }
    
    animationFrameId.current = requestAnimationFrame(animate)
    
    return () => {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current)
      }
    }
  }, [movePlayer, viewport, playerAvatar, currentZone, canvasSize, drawMinimap, peerIds, users])

  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current) {
        const width = window.innerWidth
        const height = window.innerHeight
        
        canvasRef.current.width = width
        canvasRef.current.height = height
        
        setCanvasSize({ width, height })
        setViewport(prev => ({ ...prev, width, height }))
      }
    }
    
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return

    const x = e.clientX - rect.left + viewport.x
    const y = e.clientY - rect.top + viewport.y
    
    const newZone = checkZone({ x, y })
    if (newZone !== currentZone) {
      setCurrentZone(newZone)
    }
  }, [viewport, currentZone])

  const [showJoinDialog, setShowJoinDialog] = useState(false)

  const handleCanvasClick = useCallback(async () => {
    if (!currentZone) return

    try {
      if (state === 'connected') {
        await leaveRoom();
      }
      if (currentZone.huddleRoomId) {
        await joinVideoRoom(currentZone.huddleRoomId)
        setActiveVideoRoom(currentZone.huddleRoomId)
      } else {
        setShowJoinDialog(true)
      }
    } catch (error) {
      console.error('Failed to handle video room:', error)
    }
  }, [currentZone, joinVideoRoom])

  const handleJoinRoom = async (roomId: string) => {
    try {
      await joinVideoRoom(roomId)
      setActiveVideoRoom(roomId)
      setCurrentZone(prev => prev ? {
        ...prev,
        huddleRoomId: roomId
      } : null)
      setShowJoinDialog(false)
    } catch (error) {
      console.error('Failed to join room:', error)
    }
  }

  const handleCreateRoom = async () => {
    if (!currentZone) return
    
    try {
      const videoRoom = await createVideoRoom(currentZone.x, currentZone.y)
      setActiveVideoRoom(videoRoom.huddleRoomId)
      setCurrentZone(prev => prev ? {
        ...prev,
        huddleRoomId: videoRoom.huddleRoomId
      } : null)
      setShowJoinDialog(false)
    } catch (error) {
      console.error('Failed to create room:', error)
    }
  }

  useEffect(() => {
    return () => {
      if (state === 'connected') {
        leaveRoom()
      }
    }
  }, [leaveRoom, state])

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-white">
      <canvas
        ref={canvasRef}
        width={canvasSize.width}
        height={canvasSize.height}
        className="absolute inset-0"
        style={{ touchAction: 'none' }}
        onMouseMove={handleMouseMove}
        onClick={handleCanvasClick}
      />
      <AnimatePresence>
        {showSpaceBuilder && (
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
            >
              <SpaceBuilder onClose={() => setShowSpaceBuilder(false)} />
            </motion.div>
          </div>
        )}
        {activeVideoRoom && token && (
          <div className="absolute inset-0 z-50">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              style={{ width: '100%', height: '100%' }}
            >
              <VideoRoom 
                roomId={activeVideoRoom} 
                token={token} 
                onClose={() => setActiveVideoRoom(null)}
                currentZone={currentZone}
              />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <ActionToolbar onOpenSpaceBuilder={() => setShowSpaceBuilder(true)} />
      {error && (
        <div className="absolute top-4 right-4 bg-red-500 text-white px-4 py-2 rounded shadow-lg">
          {error}
        </div>
      )}
      {isLoading && (
        <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
          <div className="bg-white p-4 rounded-lg shadow-lg">
            Loading video room...
          </div>
        </div>
      )}
      
      {state === 'connected' && (
        <Chat mode="global" currentZone={null} />
      )}
      <RoomJoinDialog 
        isOpen={showJoinDialog}
        onClose={() => setShowJoinDialog(false)}
        onJoinRoom={handleJoinRoom}
        onCreateRoom={handleCreateRoom}
        currentZone={currentZone}
      />
    </div>
  )
}
