const TOFINO_OVERVIEW_ORDER = ['donnie', 'frank', 'pazuzu', 'carrie']

export function orderTofinos<T extends { name: string }>(tofinos: T[]): T[] {
  return [...tofinos].sort((left, right) => {
    const leftName = left.name.toLowerCase()
    const rightName = right.name.toLowerCase()
    const leftIndex = TOFINO_OVERVIEW_ORDER.indexOf(leftName)
    const rightIndex = TOFINO_OVERVIEW_ORDER.indexOf(rightName)

    if (leftIndex !== -1 || rightIndex !== -1) {
      if (leftIndex === -1) return 1
      if (rightIndex === -1) return -1
      return leftIndex - rightIndex
    }

    return left.name.localeCompare(right.name, undefined, {
      sensitivity: 'base',
    })
  })
}
