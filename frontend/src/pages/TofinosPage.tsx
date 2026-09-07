import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Cpu } from 'lucide-react'
import { useMe, useServers, useTofinoPorts, useTofinos } from '../api/queries'
import type { TofinoPort } from '../api/types'
import { Card, Skeleton } from '../components/Card'
import { EditTofinoPortModal } from '../components/EditTofinoPortModal'
import { TofinoFaceplate } from '../components/TofinoFaceplate'
import { cn } from '../lib/cn'
import { orderTofinos } from '../lib/tofinoOrder'
import {
  createUsageColorMap,
  FACEPLATE_COMMENT_COLORS,
} from '../lib/usageColors'

export function TofinosPage() {
  const { data, isLoading: tofinosLoading } = useTofinos()
  const { data: portsData, isLoading: portsLoading } = useTofinoPorts()
  const { data: serversData } = useServers()
  const { data: me } = useMe()
  const [editPort, setEditPort] = useState<TofinoPort | null>(null)
  const [hoveredComment, setHoveredComment] = useState<string | null>(null)
  const [selectedComment, setSelectedComment] = useState<string | null>(null)
  const ports = portsData?.ports ?? []
  const tofinos = orderTofinos(data?.tofinos ?? [])
  const isAdmin = me?.user?.is_admin ?? false
  const commentColors = createUsageColorMap(
    ports.map((port) => port.comment),
    FACEPLATE_COMMENT_COLORS,
  )

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl font-black">Tofinos</h2>
        <p className="mt-1 text-sm font-bold text-berry-700/70 dark:text-rose-100/70">
          Front-panel overview of every switch.
        </p>
      </div>
      {tofinosLoading || portsLoading ? (
        <Skeleton className="h-48" />
      ) : tofinos.length === 0 ? (
        <Card>
          <p className="font-bold text-berry-700/70 dark:text-rose-100/70">
            No Tofinos configured yet.
          </p>
        </Card>
      ) : (
        <div className="space-y-8">
          {tofinos.map((tofino) => {
            const tofinoPorts = ports.filter(
              (port) => port.tofino_id === tofino.id,
            )
            const connected = tofinoPorts.filter((port) => port.peer_label)
            return (
              <section
                key={tofino.id}
                className={cn('space-y-3', !tofino.active && 'opacity-60')}
                aria-labelledby={`tofino-${tofino.id}-title`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2
                      id={`tofino-${tofino.id}-title`}
                      className="flex items-center gap-2 font-display text-xl font-black"
                    >
                      <Cpu
                        className="size-5 text-primary dark:text-blush"
                        aria-hidden="true"
                      />
                      {tofino.name}
                      <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-black text-primary dark:bg-blush/15 dark:text-blush">
                        Tofino {tofino.version}
                      </span>
                    </h2>
                    <p className="mt-1 text-sm font-bold text-berry-700/70 dark:text-rose-100/70">
                      {connected.length}/{tofinoPorts.length} ports connected
                      {tofino.notes ? ` — ${tofino.notes}` : ''}
                      {!tofino.active ? ' — Inactive' : ''}
                    </p>
                  </div>
                  <Link
                    to={`/tofinos/${tofino.id}`}
                    className="inline-flex min-h-11 items-center gap-2 rounded-3xl bg-primary px-5 font-display text-sm font-black text-white shadow-button transition hover:-translate-y-0.5 hover:bg-secondary dark:bg-blush dark:text-berry-950"
                  >
                    Details
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Link>
                </div>
                <TofinoFaceplate
                  tofinoName={tofino.name}
                  ports={tofinoPorts}
                  commentColors={commentColors}
                  activeCommentKey={hoveredComment ?? selectedComment}
                  selectedCommentKey={selectedComment}
                  onCommentHover={setHoveredComment}
                  onCommentSelect={(key) => {
                    setHoveredComment(null)
                    setSelectedComment((current) =>
                      current === key ? null : key,
                    )
                  }}
                  onPortClick={isAdmin ? setEditPort : undefined}
                />
              </section>
            )
          })}
        </div>
      )}

      {editPort ? (
        <EditTofinoPortModal
          port={editPort}
          ports={ports}
          servers={serversData?.servers ?? []}
          onClose={() => setEditPort(null)}
        />
      ) : null}
    </div>
  )
}
