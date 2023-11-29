def verifier(S, adj_matrix):
    for u in S: # O(n^2)
        for v in S:
            if u != v and adj_matrix[u][v] == 0:
                return False
    return True
print(verifier([0,1,2,3], [[0,1,1,1],[1,0,1,1],[1,1,0,1],[1,1,1,0]]))