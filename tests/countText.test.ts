import { describe, it, expect } from 'vitest'
import { countUnits } from '@/lib/countText'

describe('countUnits', () => {
  it('counts words', () => expect(countUnits('a  b\nc', 'words')).toBe(3))
  it('empty is 0 words', () => expect(countUnits('  ', 'words')).toBe(0))
  it('counts chars unicode-safe', () => expect(countUnits('héllo', 'chars')).toBe(5))
})
